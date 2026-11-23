export interface HorizonListenerConfig {
  /**
   * Horizon server URL.
   */
  horizonUrl: string;

  /**
   * Contract IDs to listen for events on.
   */
  contractIds: string[];

  /**
   * Optional topic filter. When provided, only events whose first topic
   * symbol matches one of the configured filters are forwarded.
   *
   * Each entry may be either:
   * - an exact symbol match (e.g. `"transfer"`), or
   * - a prefix match when suffixed with `*` (e.g. `"approve*"`).
   */
  topicFilter?: string[];
}

export interface HorizonEvent {
  /**
   * Contract ID that emitted the event.
   */
  contractId: string;

  /**
   * Event type (e.g. `contract`, `system`).
   */
  type: string;

  /**
   * Topics associated with the event. The first entry is typically the
   * event symbol used for topic filtering.
   */
  topic: string[];

  /**
   * Raw event value payload.
   */
  value: unknown;

  /**
   * Ledger at which the event was emitted.
   */
  ledger: number;

  /**
   * Timestamp of the event.
   */
  createdAt: string;
}

export type HorizonEventHandler = (event: HorizonEvent) => void | Promise<void>;
