/**
 * k6 Load Test — GET /user/me (memory cache)
 *
 * setup() login 1 lần lấy token → tất cả VU dùng chung token đó
 * → request chỉ tốn: JWT validate + cache.get() (RAM) → cực nhanh
 *
 * Chạy:
 *   docker compose run --rm -e STAGE=burst k6 run /scripts/get_user.js
 */

import http  from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate    = new Rate('get_user_error_rate');
const getUserDuration = new Trend('get_user_duration_ms', true);

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
    rate:            10,
    timeUnit:        '1s',
    duration:        '5s',
    preAllocatedVUs: 200,
    maxVUs:          500,
  },
  max: {
    executor:        'constant-arrival-rate',
    rate:            3000,
    timeUnit:        '1s',
    duration:        '30s',
    preAllocatedVUs: 500,
    maxVUs:          1000,
  },
};

const stage = __ENV.STAGE || 'burst';

export const options = {
  scenarios: {
    get_user_rps: PROFILES[stage] ?? PROFILES.burst,
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
  thresholds: {
    http_req_duration:    ['p(95)<50', 'p(99)<100'],  // cache hit phải rất nhanh
    http_req_failed:      ['rate<0.01'],
    get_user_error_rate:  ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5005';

// setup() chạy 1 lần trước khi test — login lấy token
export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ username: 'loadtest_1@example.com', password: 'Password@123' }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  const json = JSON.parse(res.body);
  if (res.status !== 200) {
    throw new Error(`Login failed: ${res.body}`);
  }

  return {
    token: json.data.token.access_token,
  };
}

// VU function — nhận token từ setup()
export default function (data) {
  const res = http.get(`${BASE_URL}/user/me`, {
    headers: {
      Authorization: `Bearer ${data.token}`,
    },
  });

  let json;
  try { json = JSON.parse(res.body); } catch { json = {}; }

  const ok = check(res, {
    'HTTP 200':      (r) => r.status === 200,
    'has user data': (r) => !!json?.data?.user?.uid,
  });

  // Latency check riêng — không tính vào error rate
  check(res, { 'under 50ms': (r) => r.timings.duration < 50 });

  errorRate.add(!ok);
  getUserDuration.add(res.timings.duration);
}

export function handleSummary(data) {
  const duration  = data.metrics['http_req_duration'];
  const errorRate = data.metrics['http_req_failed'];
  const rps       = data.metrics['http_reqs'];

  console.log('\n========== GET /user/me (MEMORY CACHE) ==========');
  console.log(`Total requests : ${rps?.values?.count ?? '-'}`);
  console.log(`Throughput     : ${(rps?.values?.rate ?? 0).toFixed(1)} req/s`);
  console.log(`Avg latency    : ${(duration?.values?.avg ?? 0).toFixed(2)} ms`);
  console.log(`p95 latency    : ${(duration?.values['p(95)'] ?? 0).toFixed(2)} ms`);
  console.log(`p99 latency    : ${(duration?.values['p(99)'] ?? 0).toFixed(2)} ms`);
  console.log(`Error rate     : ${((errorRate?.values?.rate ?? 0) * 100).toFixed(2)} %`);
  console.log('==================================================\n');

  return {
    '/scripts/result_get_user.json': JSON.stringify(data, null, 2),
  };
}
