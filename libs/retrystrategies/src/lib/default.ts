// default.ts định nghĩa DefaultRetryStrategy — retry với khoảng cách cố định.
// Tương đương convoy/retrystrategies/default.go.

import type { RetryStrategy } from './retry';

/**
 * DefaultRetryStrategy là chiến lược retry đơn giản: luôn chờ một khoảng thời gian cố định.
 * Tương đương DefaultRetryStrategy struct trong Go.
 */
export class DefaultRetryStrategy implements RetryStrategy {
  private readonly intervalSeconds: number;

  constructor(intervalSeconds: number) {
    this.intervalSeconds = intervalSeconds;
  }

  /**
   * nextDuration trả về khoảng thời gian chờ cố định (ms).
   * Tương đương (r *DefaultRetryStrategy) NextDuration(attempts uint64) time.Duration trong Go.
   *
   * @param _attempts - không dùng, chờ luôn bằng intervalSeconds
   */
  nextDuration(_attempts: number): number {
    return this.intervalSeconds * 1000;
  }
}

/**
 * newDefault tạo một DefaultRetryStrategy với interval cho trước.
 * Tương đương NewDefault(intervalSeconds uint64) *DefaultRetryStrategy trong Go.
 *
 * @param intervalSeconds - số giây chờ giữa các lần retry
 */
export function newDefault(intervalSeconds: number): DefaultRetryStrategy {
  return new DefaultRetryStrategy(intervalSeconds);
}
