/**
 * Seed script — tạo user test trong DB trước khi chạy k6.
 * Chạy: node apps/auth/test/load/seed.js
 *
 * Yêu cầu: server auth phải đang chạy.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5005';
const TOTAL    = parseInt(process.env.SEED_COUNT || '10', 10);

async function registerUser(i) {
  const body = JSON.stringify({
    firstName: 'Load',
    lastName:  `User${i}`,
    email:     `loadtest_${i}@example.com`,
    password:  'Password@123',
  });

  const res = await fetch(`${BASE_URL}/user/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const json = await res.json();
  if (res.ok) {
    process.stdout.write(`✓ user ${i}\r`);
  } else {
    // email đã tồn tại → bỏ qua
    if (json?.message?.includes('already exists')) return;
    console.error(`✗ user ${i}:`, json?.message);
  }
}

(async () => {
  console.log(`Seeding ${TOTAL} test users → ${BASE_URL}`);
  // Chạy tuần tự để không quá tải server khi seed
  for (let i = 1; i <= TOTAL; i++) {
    await registerUser(i);
  }
  console.log(`\nDone. Dùng email: loadtest_1@example.com .. loadtest_${TOTAL}@example.com`);
})();
