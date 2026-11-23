/**
 * Structured audit logging for SEP-10 authentication events.
 *
 * Compliance teams need a record of who authenticated, from which client
 * domain, and when. This module provides an optional, pluggable audit logger
 * hook that emits structured events for challenge, verify, and revoke
 * operations. Account addresses are redacted before they leave the process.
 */

export type AuditEventType = "challenge" | "verify" | "revoke";

export type AuditOutcome = "success" | "failure";

export interface AuditEvent {
  /** The authentication operation that produced this event. */
  event: AuditEventType;
  /** Whether the operation succeeded. */
  outcome: AuditOutcome;
  /** Redacted account address (e.g. `GABC...WXYZ`), when known. */
  account?: string;
  /** Client domain associated with the request, when known. */
  clientDomain?: string;
  /** ISO-8601 timestamp of when the event occurred. */
  timestamp: string;
  /** Optional error message for failed operations. */
  error?: string;
  /** Optional additional structured context. */
  metadata?: Record<string, unknown>;
}

export type AuditLogger = (event: AuditEvent) => void;

export interface AuditEventInput {
  event: AuditEventType;
  outcome?: AuditOutcome;
  account?: string;
  clientDomain?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Redact an account address so it can be safely written to audit logs.
 *
 * Keeps a short prefix and suffix for correlation while hiding the bulk of
 * the address. Short or empty values are fully masked.
 */
export function redactAddress(address?: string | null): string | undefined {
  if (!address) {
    return undefined;
  }
  const value = String(address);
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Build a structured, redacted audit event from raw input.
 */
export function buildAuditEvent(input: AuditEventInput): AuditEvent {
  const event: AuditEvent = {
    event: input.event,
    outcome: input.outcome ?? "success",
    timestamp: new Date().toISOString(),
  };

  const account = redactAddress(input.account);
  if (account !== undefined) {
    event.account = account;
  }
  if (input.clientDomain !== undefined) {
    event.clientDomain = input.clientDomain;
  }
  if (input.error !== undefined) {
    event.error = input.error;
  }
  if (input.metadata !== undefined) {
    event.metadata = input.metadata;
  }

  return event;
}

/**
 * Optional audit logger hook. When configured, authentication operations
 * emit structured, redacted audit events through this logger.
 */
export class AuditLoggerHook {
  private readonly logger?: AuditLogger;

  constructor(logger?: AuditLogger) {
    this.logger = logger;
  }

  /** Whether an audit logger has been configured. */
  get enabled(): boolean {
    return typeof this.logger === "function";
  }

  /**
   * Emit an audit event. No-op when no logger is configured. Errors thrown by
   * the logger are swallowed so auditing never breaks authentication.
   */
  emit(input: AuditEventInput): void {
    if (!this.logger) {
      return;
    }
    try {
      this.logger(buildAuditEvent(input));
    } catch {
      // Auditing must never interfere with the authentication flow.
    }
  }
}
