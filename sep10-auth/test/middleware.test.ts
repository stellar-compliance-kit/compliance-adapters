import { Keypair, Networks } from '@stellar/stellar-sdk';
import { generateChallenge } from '../src/challenge';
import { createSep10Middleware } from '../src/middleware';
import type { Request, Response, NextFunction } from 'express';

const homeDomain = 'localhost:3000';

function signChallenge(transactionXDR: string, networkPassphrase: string, keypair: Keypair): string {
  const { Transaction } = require('@stellar/stellar-sdk');
  const tx = new Transaction(transactionXDR, networkPassphrase);
  tx.sign(keypair);
  return Buffer.from(tx.toXDR()).toString('base64');
}

describe('createSep10Middleware', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      header: jest.fn(),
      stellarAddress: undefined,
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('validates a properly signed SEP-10 challenge and sets stellarAddress', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();

    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
      homeDomain,
      webAuthDomain: homeDomain,
      networkPassphrase: Networks.TESTNET,
    });

    const signedXDR = signChallenge(challenge.transactionXDR, Networks.TESTNET, clientKeypair);

    const middleware = createSep10Middleware({
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: homeDomain,
      webAuthDomain: homeDomain,
    });

    (req.header as jest.Mock).mockReturnValue(`Bearer ${signedXDR}`);

    middleware(req as Request, res as Response, next);

    expect(req.stellarAddress).toBe(clientKeypair.publicKey());
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects requests with missing Authorization header', () => {
    const serverKeypair = Keypair.random();

    const middleware = createSep10Middleware({
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: homeDomain,
      webAuthDomain: homeDomain,
    });

    (req.header as jest.Mock).mockReturnValue(undefined);

    middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'unauthorized',
      reason: 'missing bearer token',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with malformed Authorization header (missing Bearer scheme)', () => {
    const serverKeypair = Keypair.random();

    const middleware = createSep10Middleware({
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: homeDomain,
      webAuthDomain: homeDomain,
    });

    (req.header as jest.Mock).mockReturnValue('BasicAuth token123');

    middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'unauthorized',
      reason: 'missing bearer token',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with missing Bearer token value', () => {
    const serverKeypair = Keypair.random();

    const middleware = createSep10Middleware({
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: homeDomain,
      webAuthDomain: homeDomain,
    });

    (req.header as jest.Mock).mockReturnValue('Bearer ');

    middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'unauthorized',
      reason: 'missing bearer token',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with an invalid signed XDR', () => {
    const serverKeypair = Keypair.random();

    const middleware = createSep10Middleware({
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: homeDomain,
      webAuthDomain: homeDomain,
    });

    (req.header as jest.Mock).mockReturnValue('Bearer invalid-base64-xdr');

    middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'unauthorized',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a valid XDR signed by the wrong keypair', () => {
    const serverKeypair = Keypair.random();
    const clientKeypair = Keypair.random();
    const wrongKeypair = Keypair.random();

    const challenge = generateChallenge(clientKeypair.publicKey(), serverKeypair, {
      homeDomain,
      webAuthDomain: homeDomain,
      networkPassphrase: Networks.TESTNET,
    });

    const wronglySignedXDR = signChallenge(challenge.transactionXDR, Networks.TESTNET, wrongKeypair);

    const middleware = createSep10Middleware({
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomains: homeDomain,
      webAuthDomain: homeDomain,
    });

    (req.header as jest.Mock).mockReturnValue(`Bearer ${wronglySignedXDR}`);

    middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'unauthorized',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });
});
