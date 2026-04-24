// ---------------------------------------------------------------------------
// Enums / string types
// ---------------------------------------------------------------------------

export type StrategyProvider   = 'linear' | 'exponential';
export const LinearStrategyProvider:      StrategyProvider = 'linear';
export const ExponentialStrategyProvider: StrategyProvider = 'exponential';


// ---------------------------------------------------------------------------
// Metadata (retry info)
// ---------------------------------------------------------------------------

export interface Metadata {
  data?:            string;   // JSON raw
  raw:              string;
  strategy:         StrategyProvider;
  nextSendTime:     Date;
  numTrials:        number;
  intervalSeconds:  number;
  retryLimit:       number;
  maxRetrySeconds:  number;
}