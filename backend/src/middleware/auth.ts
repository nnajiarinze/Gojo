import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Auth middleware placeholder.
 * TODO: Implement Clerk JWT verification.
 * - Extract Bearer token from Authorization header
 * - Verify token signature with Clerk secret
 * - Attach userId to request
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = authHeader.slice(7);

  // TODO: Verify Clerk JWT and extract user claims
  // const claims = await clerkClient.verifyToken(token);
  // request.userId = claims.sub;

  // Stub: extract userId from token placeholder
  (request as any).userId = '00000000-0000-0000-0000-000000000001';
}

// Augment Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}
