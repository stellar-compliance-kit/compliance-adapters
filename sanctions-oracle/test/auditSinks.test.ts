import {
  createS3AuditLogger,
  createGcsAuditLogger,
  combineAuditLoggers,
  S3PutObjectClient,
  GcsStorageClient,
} from '../src/auditSinks';
import { AuditLogEntry } from '../src/sync';
import { parseArgs } from '../src/sync';

const entry: AuditLogEntry = {
  address: 'GCDVWDVSFNX43HOAIMRLPHJAQMPRRDZGRUE6DM6IFSV35BBNMGEZ662M',
  timestamp: '2026-11-24T10:00:00.000Z',
  source: 'mock-watchlist-v1',
  txHash: 'abc123',
};

describe('S3 audit sink', () => {
  it('writes each event as a JSON object with bucket, key prefix and content type', async () => {
    const send = jest.fn().mockResolvedValue({});
    const client: S3PutObjectClient = { send };
    const logger = createS3AuditLogger({ bucket: 'audit-bucket', prefix: '/audit/sanctions/', client });

    await logger(entry);

    expect(send).toHaveBeenCalledTimes(1);
    const params = send.mock.calls[0][0] as Record<string, unknown>;
    const input = (params.input ?? params) as Record<string, string>;
    expect(input.Bucket).toBe('audit-bucket');
    expect(input.Key).toMatch(/^audit\/sanctions\/2026\/11\/24\/.*-abc123-.*\.json$/);
    expect(input.ContentType).toBe('application/x-ndjson');
    expect(JSON.parse(input.Body)).toEqual(entry);
  });

  it('propagates upload failures to the caller', async () => {
    const client: S3PutObjectClient = { send: jest.fn().mockRejectedValue(new Error('S3 down')) };
    await expect(createS3AuditLogger({ bucket: 'b', client })(entry)).rejects.toThrow('S3 down');
  });
});

describe('GCS audit sink', () => {
  it('writes each event to a prefixed object with an injected Storage mock', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const file = jest.fn().mockReturnValue({ save });
    const bucket = jest.fn().mockReturnValue({ file });
    const client: GcsStorageClient = { bucket } as GcsStorageClient;
    const logger = createGcsAuditLogger({ bucket: 'gcs-bucket', prefix: 'audit', client });

    await logger(entry);

    expect(bucket).toHaveBeenCalledWith('gcs-bucket');
    expect(file).toHaveBeenCalledWith(expect.stringMatching(/^audit\/2026\/11\/24\/.*\.json$/));
    expect(JSON.parse(save.mock.calls[0][0])).toEqual(entry);
  });
});

describe('audit sink composition and CLI flags', () => {
  it('fans an event out to every configured sink', async () => {
    const a = jest.fn().mockResolvedValue(undefined);
    const b = jest.fn().mockResolvedValue(undefined);
    await combineAuditLoggers(a, b)(entry);
    expect(a).toHaveBeenCalledWith(entry);
    expect(b).toHaveBeenCalledWith(entry);
  });

  it('parses S3 and GCS audit destinations', () => {
    const args = parseArgs([
      '--audit-s3',
      's3://bucket/prefix',
      '--audit-gcs',
      'gs://other/audit/path',
    ]);
    expect(args.auditS3Uri).toBe('s3://bucket/prefix');
    expect(args.auditGcsUri).toBe('gs://other/audit/path');
  });
});
