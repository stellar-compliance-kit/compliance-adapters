import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createClient } from "redis";

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const INTROSPECT_SECRET = process.env.INTROSPECT_SECRET || "";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const redis = createClient({ url: REDIS_URL });
redis.connect().catch((err) => {
  console.error("redis connect failed", err);
});

interface Sep10Claims {
  sub: string;
  exp: number;
  iat?: number;
  client_domain?: string;
  jti?: string;
}

function isRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return Promise.resolve(false);
  return redis
    .get(`revoked:${jti}`)
    .then((val) => val !== null)
    .catch(() => false);
}

function requireIntrospectAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!INTROSPECT_SECRET) {
    res.status(500).json({ error: "introspection not configured" });
    return;
  }
  const header = req.header("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const provided = match ? match[1] : req.header("x-introspect-secret") || "";
  if (!provided || provided !== INTROSPECT_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

app.post("/introspect", requireIntrospectAuth, async (req: Request, res: Response) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) {
    res.json({ active: false });
    return;
  }

  let claims: Sep10Claims;
  try {
    claims = jwt.verify(token, JWT_SECRET) as Sep10Claims;
  } catch {
    res.json({ active: false });
    return;
  }

  if (await isRevoked(claims.jti)) {
    res.json({ active: false });
    return;
  }

  res.json({
    active: true,
    sub: claims.sub,
    exp: claims.exp,
    client_domain: claims.client_domain,
  });
});

export { app };
