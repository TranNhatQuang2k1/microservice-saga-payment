/**
 * k6 Load Test — GET /user/profile (decode-only auth + memory cache)
 *
 * So sánh với get_user.js (/user/me):
 *   /user/me     → requireAuth: verify JWT + blacklist check (cache) + user fetch (cache)
 *   /user/profile → decodeAuth:  verify JWT signature only  + user fetch (cache)
 *
 * → /user/profile bỏ 1 cache call (blacklist), nên lý thuyết nhanh hơn một chút
 * → Trade-off: token bị revoke (logout) vẫn pass đến khi hết hạn tự nhiên
 *
 * Chạy:
 *   docker compose run --rm -e STAGE=burst -e BASE_URL=http://172.19.128.1:5005 k6 run /scripts/get_profile.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate       = new Rate('get_profile_error_rate');
const profileDuration = new Trend('get_profile_duration_ms', true);

const PROFILES = {
  smoke: {
    executor:        'constant-arrival-rate',
    rate:            100,
    timeUnit:        '1s',
    duration:        '30s',
    preAllocatedVUs: 50,
    maxVUs:          200,
  },
  burst: {
    executor:        'constant-arrival-rate',
    rate:            200,
    timeUnit:        '1s',
    duration:        '10s',
    preAllocatedVUs: 200,
    maxVUs:          500,
  },
  max: {
    executor:        'constant-arrival-rate',
    rate:            1100,
    timeUnit:        '1s',
    duration:        '10s',
    preAllocatedVUs: 500,
    maxVUs:          1000,
  },
};

const stage ='max';

export const options = {
  scenarios: {
    get_profile_rps: PROFILES[stage] ?? PROFILES.burst,
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    http_req_duration:       ['p(95)<50', 'p(99)<100'],
    http_req_failed:         ['rate<0.01'],
    get_profile_error_rate:  ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5005';

export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ username: 'loadtest_1@example.com', password: 'Password@123' }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.body}`);
  }

  const json = JSON.parse(res.body);
  return { token: json.data.token.access_token };
}

export default function (data) {
  const res = http.get(`${BASE_URL}/user/profile`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });

  let json;
  try { json = JSON.parse(res.body); } catch { json = {}; }

  const ok = check(res, {
    'HTTP 200':      (r) => r.status === 200,
    'has user data': (r) => !!json?.data?.user?.uid,
  });

  check(res, { 'under 50ms': (r) => r.timings.duration < 50 });

  errorRate.add(!ok);
  profileDuration.add(res.timings.duration);
}

export function handleSummary(data) {
  const duration  = data.metrics['http_req_duration'];
  const errRate   = data.metrics['http_req_failed'];
  const rps       = data.metrics['http_reqs'];

  console.log('\n========== GET /user/profile (DECODE-ONLY AUTH + CACHE) ==========');
  console.log(`Total requests : ${rps?.values?.count ?? '-'}`);
  console.log(`Throughput     : ${(rps?.values?.rate ?? 0).toFixed(1)} req/s`);
  console.log(`Avg latency    : ${(duration?.values?.avg ?? 0).toFixed(2)} ms`);
  console.log(`p95 latency    : ${(duration?.values['p(95)'] ?? 0).toFixed(2)} ms`);
  console.log(`p99 latency    : ${(duration?.values['p(99)'] ?? 0).toFixed(2)} ms`);
  console.log(`Error rate     : ${((errRate?.values?.rate ?? 0) * 100).toFixed(2)} %`);
  console.log('===================================================================\n');

}
