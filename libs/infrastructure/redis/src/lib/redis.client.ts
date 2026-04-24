import { type RedisOptions, Cluster, Redis } from 'ioredis';
import * as fs from 'node:fs';
import * as tls from 'node:tls';
import type { RedisConfiguration } from '@org/configurations';
import { isSentinel, buildRedisDsn, hasTLSConfig } from '@org/configurations';

// ---------------------------------------------------------------------------
// TLSConfig
// Chứa thông tin để thiết lập kết nối TLS (mã hoá) với Redis.
//
// TLS LÀ GÌ VÀ TẠI SAO CẦN?
// TLS (Transport Layer Security) mã hoá dữ liệu truyền qua mạng.
// Không có TLS → password Redis, session token, dữ liệu nhạy cảm đi qua
// mạng dưới dạng plain text → bất kỳ ai sniff được packet đều đọc được.
//
// TRÊN PRODUCTION CÓ TÁC DỤNG GÌ?
//
// 1. skipVerify = false (default, đúng cách)
//    Redis client kiểm tra certificate của server — xác nhận đang kết nối
//    đúng Redis server thật, không phải máy giả mạo (MITM attack).
//    → Bắt buộc trên production. skipVerify=true chỉ dùng local/dev.
//
// 2. caCertFile — CA (Certificate Authority) certificate
//    Khi Redis dùng self-signed cert (không phải cert từ Let's Encrypt/DigiCert),
//    client cần file CA để verify cert đó là hợp lệ.
//    Ví dụ: Redis on-prem trong công ty tự ký cert bằng internal CA.
//    → Thiếu file này: kết nối bị từ chối dù Redis đang chạy bình thường.
//
// 3. certFile + keyFile — Client Certificate (mTLS — Mutual TLS)
//    Bình thường chỉ server có cert, client không cần.
//    mTLS = server cũng yêu cầu client xuất trình cert của mình.
//    → Dùng khi Redis cần xác thực: "mày là service nào, có được phép kết nối không?"
//    → Phổ biến trong zero-trust network, Kubernetes service mesh (Istio).
//    → cert và key phải đi kèm nhau (đã validate ở redis.config.ts).
//
// SO SÁNH VỚI GO (rdb.go buildTLSConfig):
//   Go:   InsecureSkipVerify: cfg.SkipVerify  → true = bỏ verify
//   Node: rejectUnauthorized: !cfg.skipVerify → false = bỏ verify  (NGƯỢC NHAU!)
//
// skipVerify  — bỏ qua kiểm tra certificate của server (KHÔNG dùng production)
// caCertFile  — path tới CA cert để verify server (cần khi Redis dùng self-signed cert)
// certFile    — path tới client cert (chỉ cần khi Redis bật mTLS)
// keyFile     — private key tương ứng certFile (phải đi cùng certFile)
// ---------------------------------------------------------------------------

export interface TLSConfig {
  skipVerify:  boolean;
  caCertFile:  string;
  certFile:    string;
  keyFile:     string;
}

// ---------------------------------------------------------------------------
// RedisClient
// Wrapper quanh ioredis instance — tương đương Redis struct trong rdb.go.
//
// addresses — danh sách DSN/host:port đã dùng khi khởi tạo, giữ lại để
//             debug, logging, hoặc reconnect logic sau này
// client    — ioredis instance thực sự dùng để gọi GET/SET/PUBLISH/...
//             kiểu là Redis (standalone/sentinel) hoặc Cluster (Redis Cluster)
// ---------------------------------------------------------------------------

export interface RedisClient {
  readonly addresses: string[];
  readonly client:    Redis | Cluster;
}

// ---------------------------------------------------------------------------
// buildTLSConfig (internal)
// Convert TLSConfig của chúng ta sang format mà Node.js tls module hiểu.
// Tương đương buildTLSConfig() trong rdb.go (lines 106-135).
//
// LOGIC NGƯỢC NHAU GIỮA GO VÀ NODE.JS — cẩn thận khi đọc:
//   Go   crypto/tls: InsecureSkipVerify: true  → TẮT verify (nguy hiểm)
//   Node tls module: rejectUnauthorized: false → TẮT verify (nguy hiểm)
//   → Code dùng !cfg.skipVerify để đảo chiều: skipVerify=true → rejectUnauthorized=false
//
// GO LÀM GÌ THÊM MÀ TS KHÔNG CÓ?
//   Go parse CA cert thành x509.CertPool: caCertPool.AppendCertsFromPEM(caCert)
//   Node đơn giản hơn: truyền raw Buffer vào tlsOptions.ca, Node tự xử lý
//
// OUTPUT FIELDS:
//   rejectUnauthorized — có verify server cert không (false = bỏ qua, production=true)
//   ca   — Buffer của CA cert; Node dùng để verify Redis server certificate
//   cert — Buffer của client cert; gửi lên server trong TLS handshake (mTLS)
//   key  — Buffer của private key; dùng để ký TLS handshake, chứng minh cert là của mình
// ---------------------------------------------------------------------------

function buildTLSConfig(cfg: TLSConfig): tls.ConnectionOptions {
  const tlsOptions: tls.ConnectionOptions = {
    rejectUnauthorized: !cfg.skipVerify, // ngược với Go's InsecureSkipVerify
  };

  // Load CA cert nếu có — dùng để verify server khi CA không phải public CA
  if (cfg.caCertFile) {
    try {
      tlsOptions.ca = fs.readFileSync(cfg.caCertFile);
    } catch (err) {
      throw new Error(`failed to read CA certificate: ${(err as Error).message}`);
    }
  }

  // Load client cert + key — chỉ cần khi Redis yêu cầu mutual TLS (mTLS)
  // cert và key phải đi cùng nhau (đã validate ở redis.config.ts)
  if (cfg.certFile && cfg.keyFile) {
    try {
      tlsOptions.cert = fs.readFileSync(cfg.certFile);
      tlsOptions.key  = fs.readFileSync(cfg.keyFile);
    } catch (err) {
      throw new Error(`failed to load client certificate: ${(err as Error).message}`);
    }
  }

  return tlsOptions;
}

// ---------------------------------------------------------------------------
// newClientWithTLS
// Tạo ioredis client với TLS tuỳ chọn.
// Tương đương NewClientWithTLS() trong rdb.go (lines 39-104).
//
// DSN LÀ GÌ?
// DSN = Data Source Name — chuỗi URL chuẩn chứa toàn bộ thông tin kết nối:
//   redis://[username:password@]host:port[/database]
//   rediss://...                              ← scheme "rediss" = Redis over TLS
//
// Ví dụ thực tế:
//   redis://localhost:6379                    ← local dev, không auth
//   redis://user:s3cr3t@redis.prod.com:6379/0 ← production, có auth, db=0
//   rediss://user:s3cr3t@redis.prod.com:6380  ← production + TLS
//
// TẠI SAO DÙNG DSN THAY VÌ TRUYỀN TỪNG THAM SỐ?
//   - Chuẩn hoá: 1 env var thay vì 5 (host, port, user, pass, db)
//   - ioredis tự parse URL → không cần code thủ công
//   - Dễ copy/paste giữa các env (dev, staging, prod)
//   - Secret manager (AWS Secrets Manager, Vault) trả về dạng URL sẵn
//
// LOGIC CHỌN LOẠI CLIENT (giống Go):
//   1 address  → Redis standalone: new Redis(url)
//               ioredis tự parse URL, tự handle auth, db selection
//   N addresses → Redis Cluster:   new Cluster([{host, port}, ...])
//               dùng khi Redis chạy cluster mode (sharding dữ liệu ra nhiều node)
//               Cluster không nhận URL → phải parse thủ công ra {host, port}
// ---------------------------------------------------------------------------

export function newClientWithTLS(addresses: string[], tlsCfg?: TLSConfig): RedisClient {
  if (addresses.length === 0) {
    throw new Error('redis addresses list cannot be empty');
  }
  for (const addr of addresses) {
    if (!addr.trim()) throw new Error('dsn cannot be empty');
  }

  const tlsOptions = tlsCfg ? buildTLSConfig(tlsCfg) : undefined;

  let client: Redis | Cluster;

  if (addresses.length === 1) {
    // Standalone — ioredis nhận URL string trực tiếp, tự parse host/port/auth/db
    // tlsOptions override lên TLS config mà ioredis tự detect từ scheme rediss://
    const opts: RedisOptions = tlsOptions ? { tls: tlsOptions } : {};
    client = new Redis(addresses[0], opts);
  } else {
    // Cluster — ioredis cần array of {host, port}, không nhận URL
    // nên mình parse thủ công từ "host:port" hoặc "redis://host:port"
    const nodes = addresses.map((addr) => {
      const url = addr.includes('://') ? new URL(addr) : null;
      return url
        ? { host: url.hostname, port: parseInt(url.port || '6379', 10) }
        : (() => {
            const [host, port] = addr.split(':');
            return { host, port: parseInt(port ?? '6379', 10) };
          })();
    });

    // redisOptions — options áp dụng cho từng node trong cluster
    client = new Cluster(nodes, {
      redisOptions: tlsOptions ? { tls: tlsOptions } : {},
    });
  }

  attachListeners(client, addresses);

  return { addresses, client };
}

// ---------------------------------------------------------------------------
// newClient
// Tạo client không TLS — shorthand của newClientWithTLS không truyền tlsCfg.
// Tương đương NewClient() trong rdb.go.
// Dùng khi Redis chạy trong internal network không cần mã hoá.
// ---------------------------------------------------------------------------

export function newClient(addresses: string[]): RedisClient {
  return newClientWithTLS(addresses);
}

// ---------------------------------------------------------------------------
// newFailoverClient (internal)
// Tạo ioredis client theo mode Sentinel.
// Tương đương newFailoverClient() trong rdb.go.
//
// Redis Sentinel là HA (High Availability) setup:
//   - Có 1+ sentinel process giám sát master + replica
//   - Khi master down, sentinel tự bầu replica lên làm master
//   - Client kết nối tới sentinel, sentinel báo địa chỉ master hiện tại
//
// sentinels  — danh sách {host, port} của các sentinel process (không phải Redis)
// name       — tên master mà sentinel quản lý (SENTINEL_MASTER_NAME trong env)
// sentinelUsername/sentinelPassword — auth với sentinel process
// username/password                 — auth với Redis master/replica
// db         — Redis database index (0–15), mặc định 0
// ---------------------------------------------------------------------------

function newFailoverClient(cfg: RedisConfiguration): RedisClient {
  const sentinelAddrs = cfg.addresses
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

  // Fallback: nếu không có CLUSTER_ADDRESSES thì dùng HOST:PORT
  const fallbackAddrs =
    sentinelAddrs.length > 0
      ? sentinelAddrs
      : cfg.host && cfg.port > 0
        ? [`${cfg.host}:${cfg.port}`]
        : [];

  if (fallbackAddrs.length === 0) {
    throw new Error('redis sentinel addresses are required');
  }
  if (!cfg.masterName.trim()) {
    throw new Error('redis sentinel master_name is required');
  }

  const db = cfg.database ? parseInt(cfg.database, 10) : 0;
  if (cfg.database && isNaN(db)) {
    throw new Error('redis database must be a valid integer');
  }

  // Sentinel nodes là địa chỉ của sentinel process, thường port 26379
  const sentinelNodes = fallbackAddrs.map((addr) => {
    const [host, port] = addr.split(':');
    return { host, port: parseInt(port ?? '26379', 10) };
  });

  const tlsOptions = hasTLSConfig(cfg)
    ? buildTLSConfig({
        skipVerify: cfg.tlsSkipVerify,
        caCertFile: cfg.tlsCACertFile,
        certFile:   cfg.tlsCertFile,
        keyFile:    cfg.tlsKeyFile,
      })
    : undefined;

  // ioredis tự động kết nối tới sentinel để hỏi địa chỉ master,
  // sau đó kết nối tới master thực sự — transparent với application code
  const client = new Redis({
    sentinels:        sentinelNodes,     // danh sách sentinel
    name:             cfg.masterName.trim(), // tên master trong sentinel config
    sentinelUsername: cfg.sentinelUsername || undefined,
    sentinelPassword: cfg.sentinelPassword || undefined,
    username:         cfg.username || undefined, // Redis AUTH
    password:         cfg.password || undefined,
    db,
    ...(tlsOptions ? { tls: tlsOptions } : {}),
  });

  attachListeners(client, fallbackAddrs);

  return { addresses: fallbackAddrs, client };
}

// ---------------------------------------------------------------------------
// newClientFromConfig
// Entry point chính — nhận RedisConfiguration từ redis.config.ts,
// tự detect mode rồi tạo đúng loại client.
// Tương đương NewClientFromRedisConfig() trong rdb.go.
//
// Thứ tự ưu tiên:
//   scheme=redis-sentinel → Sentinel mode (newFailoverClient)
//   addresses có N phần tử → Cluster mode (newClientWithTLS + Cluster)
//   còn lại               → Standalone mode (newClientWithTLS + Redis)
// ---------------------------------------------------------------------------

export function newClientFromConfig(cfg: RedisConfiguration): RedisClient {
  // isSentinel kiểm tra cfg.scheme === 'redis-sentinel'
  if (isSentinel(cfg)) {
    return newFailoverClient(cfg);
  }

  // buildRedisDsn trả về [] nếu scheme rỗng, [url] nếu standalone,
  // hoặc [url1, url2, ...] nếu CLUSTER_ADDRESSES được set
  const addresses = buildRedisDsn(cfg);
  if (addresses.length === 0) {
    throw new Error('redis dsn is empty');
  }

  // hasTLSConfig kiểm tra có bất kỳ TLS field nào được set không
  const tlsCfg = hasTLSConfig(cfg)
    ? {
        skipVerify: cfg.tlsSkipVerify,
        caCertFile: cfg.tlsCACertFile,
        certFile:   cfg.tlsCertFile,
        keyFile:    cfg.tlsKeyFile,
      }
    : undefined;

  return newClientWithTLS(addresses, tlsCfg);
}

// ---------------------------------------------------------------------------
// attachListeners (internal)
// Gắn event listeners vào ioredis client để log trạng thái kết nối.
//
// TẠI SAO CẦN THEO DÕI EVENTS?
// ioredis tự động reconnect khi mất kết nối, nhưng mình không biết chuyện gì
// đang xảy ra bên trong trừ khi có log. Trong production, những log này giúp:
//   - Alert khi Redis bị down (loạt error + reconnecting)
//   - Debug latency bất thường (close + reconnecting liên tục)
//   - Xác nhận kết nối thành công khi app start (connected → ready)
//   - Phân biệt "Redis bị restart" vs "network blip" vs "credentials sai"
//
// SO SÁNH VỚI GO (rdb.go):
// Go dùng go-redis + redisotel.InstrumentTracing() — tự động gắn OpenTelemetry
// tracing vào mọi Redis command, gửi trace/span lên collector (Jaeger, Datadog...).
// Node.js/ioredis không có built-in OTel như vậy → mình log thủ công ở đây.
// Để có OTel tương đương Go, thêm @opentelemetry/instrumentation-ioredis.
//
// LIFECYCLE CỦA MỘT KẾT NỐI REDIS:
//   app start
//     → [connect]     — TCP handshake thành công với Redis server
//     → [ready]       — AUTH (nếu có password) + SELECT db xong, sẵn sàng nhận lệnh
//     → ... ứng dụng chạy bình thường ...
//   mất mạng / Redis restart
//     → [error]       — lỗi xảy ra (ECONNRESET, ETIMEDOUT, NOAUTH, ...)
//     → [close]       — socket bị đóng
//     → [reconnecting]— ioredis đang thử lại (exponential backoff tự động)
//     → [connect]     — kết nối lại thành công
//     → [ready]       — sẵn sàng lại
//
// EVENTS CHI TIẾT:
// connect     — TCP connection tới Redis server đã được thiết lập.
//               Chưa dùng được — vẫn đang chờ AUTH/SELECT xong.
//
// ready       — Server xác nhận xong (HELLO/AUTH/SELECT), có thể gửi GET/SET/...
//               Đây là lúc ứng dụng thực sự "online" với Redis.
//
// error       — Có lỗi: network drop, wrong password, server OOM, timeout...
//               ioredis tự reconnect, nhưng cần log để biết tần suất lỗi.
//               Nếu không listen event này → Node.js throw UnhandledPromiseRejection.
//
// close       — Connection bị đóng hẳn (có thể sau error, hoặc gọi client.quit()).
//               Không nhất thiết là lỗi — Redis restart cũng trigger close.
//
// reconnecting — ioredis đang thử kết nối lại với built-in retry + backoff.
//                Log này báo hiệu Redis đang bị vấn đề, cần chú ý.
// ---------------------------------------------------------------------------

function attachListeners(client: Redis | Cluster, addresses: string[]): void {
  const label = addresses.join(',');

  client.on('connect',      ()    => console.log(`[redis] connected    ${label}`));
  client.on('ready',        ()    => console.log(`[redis] ready        ${label}`));
  client.on('error',        (err) => console.error(`[redis] error       ${label}`, err));
  client.on('close',        ()    => console.warn(`[redis] closed       ${label}`));
  client.on('reconnecting', ()    => console.log(`[redis] reconnecting ${label}`));
}
