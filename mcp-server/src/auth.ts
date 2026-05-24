import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

export function bearerAuth(expectedToken: string) {
  const expected = Buffer.from(expectedToken, 'utf8');

  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || !match[1]) {
      res.status(401).json({ error: 'missing_bearer_token' });
      return;
    }
    const provided = Buffer.from(match[1], 'utf8');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    next();
  };
}
