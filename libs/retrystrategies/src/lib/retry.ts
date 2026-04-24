// retry.ts định nghĩa interface RetryStrategy và factory function tạo strategy phù hợp.
// Tương đương convoy/retrystrategies/retry.go.


import { newExponential } from './exponentialBackoff';
import { newDefault } from './default';
import { ExponentialStrategyProvider, Metadata } from '@org/interfaces';

/**
 * RetryStrategy là interface mô tả chiến lược retry.
 * Tương đương RetryStrategy interface trong Go.
 */
export interface RetryStrategy {
  /**
   * nextDuration trả về khoảng thời gian chờ (ms) trước lần retry tiếp theo.
   *
   * @param attempts - số lần đã thử
   * @returns số milliseconds cần chờ
   */
  nextDuration(attempts: number): number;
}

/**
 * newRetryStrategyFromMetadata tạo RetryStrategy phù hợp dựa trên metadata.
 * Tương đương NewRetryStrategyFromMetadata(m datastore.Metadata) RetryStrategy trong Go.
 *
 * @param m - metadata chứa strategy type, interval và maxRetrySeconds
 */
export function newRetryStrategyFromMetadata(m: Metadata): RetryStrategy {
  if (m.strategy === ExponentialStrategyProvider) {
    return newExponential(m.intervalSeconds, m.maxRetrySeconds);
  }

  return newDefault(m.intervalSeconds);
}
