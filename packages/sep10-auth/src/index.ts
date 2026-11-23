import { Router, Request, Response, NextFunction } from "express";
import { Keypair, TransactionBuilder, Networks, WebAuth } from "@stellar/stellar-sdk";
import { randomBytes } from "crypto";

export interface Sep10Config {
  serverKeypair: Keypair;
  networkPassphrase?: string;
  webAuthDomain?: string;
  homeDomain: string;
  challengeExpiresIn?: number;
  auditLogger?: AuditLogger;
}

export type AuditEventType = "challenge" | "verify" | "revoke";

export interface AuditEvent {
  event: AuditEventType;
  timestamp: string;
  account?: string;
  clientDomain?: string;
  success: boolean;
  reason?: string;
}

export type AuditLogger = (event: AuditEvent) => void;

export interface Sep10Service {
  router: Router;
  challenge(req: Request, res: Response): Promise<void>;
  verify(req: Request, res: Response): Promise<void>;
  revoke(req: Request, res: Response): Promise<void>;
}

const DEFAULT_CHALLENGE_EXPIRES_IN = 300;

/**
 * Redact an account address for audit output, keeping a short prefix/suffix
 * so records remain correlatable without exposing the full address.
 */
export function redactAddress(address: string | undefined): string | undefined {
  if (!address) return undefined;
  if (address.length <= 8) return "***";
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function emitAudit(
  logger: AuditLogger | undefined,
  event: AuditEventType,
  details: { account?: string; clientDomain?: string; success: boolean; reason?: string },
): void {
  if (!logger) return;
  try {
    logger({
      event,
      timestamp: new Date().toISOString(),
      account: redactAddress(details.account),
      clientDomain: details.clientDomain,
      success: details.success,
      reason: details.reason,
    });
  } catch {
    // Audit logging must never break authentication flows.
  }
}

export function createSep10Service(config: Sep10Config): Sep10Service {
  const {
    serverKeypair,
    networkPassphrase = Networks.TESTNET,
    webAuthDomain,
    homeDomain,
    challengeExpiresIn = DEFAULT_CHALLENGE_EXPIRES_IN,
    auditLogger,
  } = config;

  const router = Router();

  async function challenge(req: Request, res: Response): Promise<void> {
    const account = (req.query.account as string) || (req.body && req.body.account);
    const clientDomain = (req.query.client_domain as string) || (req.body && req.body.client_domain);

    if (!account) {
      emitAudit(auditLogger, "challenge", { clientDomain, success: false, reason: "missing_account" });
      res.status(400).json({ error: "account is required" });
      return;
    }

    try {
      const challenge = WebAuth.buildChallengeTx(
        serverKeypair,
        account,
        homeDomain,
        challengeExpiresIn,
        networkPassphrase,
        webAuthDomain,
      );
      emitAudit(auditLogger, "challenge", { account, clientDomain, success: true });
      res.json({ transaction: challenge, network_passphrase: networkPassphrase });
    } catch (err) {
      emitAudit(auditLogger, "challenge", {
        account,
        clientDomain,
        success: false,
        reason: err instanceof Error ? err.message : "challenge_failed",
      });
      res.status(400).json({ error: "unable to build challenge" });
    }
  }

  async function verify(req: Request, res: Response): Promise<void> {
    const transaction = (req.body && req.body.transaction) || req.body;
    const clientDomain = req.body && req.body.client_domain;

    if (!transaction) {
      emitAudit(auditLogger, "verify", { clientDomain, success: false, reason: "missing_transaction" });
      res.status(400).json({ error: "transaction is required" });
      return;
    }

    let account: string | undefined;
    try {
      const result = WebAuth.readChallengeTx(
        transaction,
        serverKeypair.publicKey(),
        networkPassphrase,
        homeDomain,
        webAuthDomain,
      );
      account = result.clientAccountID;
      const token = randomBytes(32).toString("hex");
      emitAudit(auditLogger, "verify", { account, clientDomain, success: true });
      res.json({ token });
    } catch (err) {
      emitAudit(auditLogger, "verify", {
        account,
        clientDomain,
        success: false,
        reason: err instanceof Error ? err.message : "verify_failed",
      });
      res.status(400).json({ error: "unable to verify challenge" });
    }
  }

  async function revoke(req: Request, res: Response): Promise<void> {
    const account = (req.body && req.body.account) || (req.query.account as string);
    const clientDomain = (req.body && req.body.client_domain) || (req.query.client_domain as string);

    emitAudit(auditLogger, "revoke", { account, clientDomain, success: true });
    res.json({ revoked: true });
  }

  router.get("/challenge", challenge);
  router.post("/challenge", challenge);
  router.post("/verify", verify);
  router.post("/revoke", revoke);

  return { router, challenge, verify, revoke };
}
