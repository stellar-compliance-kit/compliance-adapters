/**
 * SEP-10 authentication types.
 */

/**
 * Structured audit event emitted for authentication lifecycle operations.
 * Account addresses are redacted before being placed in `account`.
 */
export interface Sep10AuditEvent {
  /** Operation that produced the event. */
  operation: 'challenge' | 'verify' | 'revoke';
  /** Redacted account address (e.g. `GABC...WXYZ`), when known. */
  account?: string;
  /** Client domain associated with the request, when known. */
  clientDomain?: string;
  /** Whether the operation succeeded. */
  success: boolean;
  /** ISO-8601 timestamp of when the event occurred. */
  timestamp: string;
  /** Optional error message when `success` is false. */
  error?: string;
}

/**
 * Optional audit logger hook. Receives structured, redacted audit events.
 */
export type Sep10AuditLogger = (event: Sep10AuditEvent) => void;

export interface Sep10Config {
  /**
   * Optional audit logger invoked on challenge, verify, and revoke operations.
   * Events contain redacted account addresses only.
   */
  auditLogger?: Sep10AuditLogger;
}
