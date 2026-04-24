// exponentialBackoff.ts định nghĩa ExponentialBackoffRetryStrategy — retry theo cấp số nhân.
// Tương đương convoy/retrystrategies/exponentialBackoff.go.

import type { RetryStrategy } from './retry';

/**
 * ExponentialBackoffRetryStrategy là chiến lược retry tăng theo cấp số nhân kèm jitter.
 * Công thức: waitSeconds = intervalSeconds * 2^attempts  (capped at maxRetrySeconds)
 * Sau đó cộng thêm jitter ngẫu nhiên tối đa 5 giây để tránh thundering herd.
 * Tương đương ExponentialBackoffRetryStrategy struct trong Go.
 */
export class ExponentialBackoffRetryStrategy implements RetryStrategy {
  private readonly intervalSeconds: number;
  private readonly maxRetrySeconds: number;

  constructor(intervalSeconds: number, maxRetrySeconds: number) {
    this.intervalSeconds = intervalSeconds;
    this.maxRetrySeconds = maxRetrySeconds;
  }

  /**
   * nextDuration tính thời gian chờ (ms) theo hàm mũ với jitter.
   * Tương đương (r *ExponentialBackoffRetryStrategy) NextDuration(attempts uint64) trong Go.
   *
   * Go dùng rand.Uint64() % 10e9 nanoseconds → chia 2 → tối đa ~5 giây jitter.
   * TypeScript port: jitter = Math.random() * 5_000 ms để có hiệu ứng tương đương.
   *
   * @param attempts - số lần đã thử (bắt đầu từ 0)
   * @returns số milliseconds cần chờ trước lần retry tiếp theo
   */
  nextDuration(attempts: number): number {
    let retrySeconds = this.intervalSeconds * Math.pow(2, attempts);
    if (retrySeconds > this.maxRetrySeconds) {
      retrySeconds = this.maxRetrySeconds;
    }

    // Jitter: Go dùng rand.Uint64() % 10e9 ns, chia 2 → tối đa ~5 000 ms
    const jitterMs = Math.random() * 5_000;

    return retrySeconds * 1000 + jitterMs;
  }
}

/**
 * newExponential tạo ExponentialBackoffRetryStrategy.
 * Nếu maxRetrySeconds = 0, mặc định là 7200 giây (2 giờ).
 * Tương đương NewExponential(intervalSeconds, maxRetrySeconds uint64) trong Go.
 *
 * @param intervalSeconds - số giây cơ sở cho lần retry đầu tiên (attempts = 0)
 * @param maxRetrySeconds - giới hạn trên của thời gian chờ (0 = dùng mặc định 7200s)
 */
export function newExponential(
  intervalSeconds: number,
  maxRetrySeconds: number,
): ExponentialBackoffRetryStrategy {
  const max = maxRetrySeconds === 0 ? 7200 : maxRetrySeconds;
  return new ExponentialBackoffRetryStrategy(intervalSeconds, max);
}
