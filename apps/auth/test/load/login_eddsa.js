/**
 * k6 Load Test — POST /auth/login (constant-arrival-rate)
 *
 * Mode này giữ đúng X req/s bất kể VU xử lý nhanh hay chậm.
 *
 * Profiles (đặt qua env STAGE):
 *   smoke  →  10 req/s, 30s  (sanity check)
 *   ramp   →  10→50→100 req/s (tìm ngưỡng chịu tải)
 *   full   →  100 req/s, 2m  (sustained — default)
 *   stress →  200 req/s, 1m  (tìm điểm gãy)
 *
 * Chạy:
 *   docker compose --profile load-test up k6
 *   STAGE=smoke docker compose --profile load-test up k6
 *   STAGE=stress docker compose --profile load-test up k6
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const errorRate     = new Rate('login_error_rate');
const loginDuration = new Trend('login_duration_ms', true);
const invalidCreds  = new Counter('invalid_credentials');

// ---------------------------------------------------------------------------
// Load profiles — constant-arrival-rate
// rate    = số request mỗi timeUnit (mặc định 1s)
// preAllocatedVUs = VU sẵn sàng, k6 tự thêm nếu thiếu (tối đa maxVUs)
// ---------------------------------------------------------------------------
const PROFILES = {
  smoke: {
    executor:        'constant-arrival-rate',
    rate:            10,
    timeUnit:        '1s',
    duration:        '10s',
    preAllocatedVUs: 20,
    maxVUs:          50,
  },
  stable: {
    executor:        'constant-arrival-rate',
    rate:            50,
    timeUnit:        '1s',
    duration:        '10s',
    preAllocatedVUs: 80,
    maxVUs:          150,
  },
  ramp: {
    executor:        'ramping-arrival-rate',
    startRate:       10,
    timeUnit:        '1s',
    stages: [
      { duration: '30s', target: 10  },
      { duration: '1m',  target: 50  },
      { duration: '1m',  target: 100 },
      { duration: '30s', target: 0   },
    ],
    preAllocatedVUs: 100,
    maxVUs:          300,
  },
  full: {
    executor:        'constant-arrival-rate',
    rate:            100,
    timeUnit:        '1s',
    duration:        '2m',
    preAllocatedVUs: 150,
    maxVUs:          400,
  },
  stress: {
    executor:        'constant-arrival-rate',
    rate:            200,
    timeUnit:        '1s',
    duration:        '1m',
    preAllocatedVUs: 300,
    maxVUs:          600,
  },
};

const stage = __ENV.STAGE || 'ramp';

export const options = {
  scenarios: {
    login_rps: PROFILES[stage] ?? PROFILES.full,
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed:   ['rate<0.01'],
    login_error_rate:  ['rate<0.01'],
  },
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const BASE_URL    = __ENV.BASE_URL || 'http://localhost:5005';
const SEED_COUNT  = parseInt(__ENV.SEED_COUNT || '10', 10); // phải khớp với seed.js

const HEADERS = { 'Content-Type': 'application/json' };

// ---------------------------------------------------------------------------
// Virtual user function — chạy lặp lại mỗi VU
// ---------------------------------------------------------------------------
export default function () {
  // Mỗi VU dùng 1 user trong pool để tránh hot-spot vào 1 row
  const i   = (__VU % SEED_COUNT) + 1;
  const body = JSON.stringify({
    username: `loadtest_${i}@example.com`,
    password: 'Password@123',
  });

  const res = http.post(`${BASE_URL}/auth/loginJwtEdDSA`, body, { headers: HEADERS });

  // Parse response an toàn
  let json;
  try { json = JSON.parse(res.body); } catch { json = {}; }

  const ok = check(res, {
    'HTTP 200':         (r) => r.status === 200,
    'has access_token': (r) => !!json?.data?.token?.access_token,
    'response < 500ms': (r) => r.timings.duration < 500,
  });

  // Track custom metrics
  errorRate.add(!ok);
  loginDuration.add(res.timings.duration);

  if (res.status === 403) {
    invalidCreds.add(1);
  }
}

// ---------------------------------------------------------------------------
// Summary in-console sau khi test xong
// ---------------------------------------------------------------------------
export function handleSummary(data) {
  const duration  = data.metrics['http_req_duration'];
  const errorRate = data.metrics['http_req_failed'];
  const rps       = data.metrics['http_reqs'];

  console.log('\n========== LOAD TEST SUMMARY ==========');
  console.log(`Total requests : ${rps?.values?.count ?? '-'}`);
  console.log(`Throughput     : ${(rps?.values?.rate ?? 0).toFixed(1)} req/s`);
  console.log(`Avg latency    : ${(duration?.values?.avg ?? 0).toFixed(1)} ms`);
  console.log(`p95 latency    : ${(duration?.values['p(95)'] ?? 0).toFixed(1)} ms`);
  console.log(`p99 latency    : ${(duration?.values['p(99)'] ?? 0).toFixed(1)} ms`);
  console.log(`Error rate     : ${((errorRate?.values?.rate ?? 0) * 100).toFixed(2)} %`);
  console.log('========================================\n');

  // Ghi kết quả ra file JSON để lưu lại
  return {
    '/scripts/result.json': JSON.stringify(data, null, 2),
  };
}
