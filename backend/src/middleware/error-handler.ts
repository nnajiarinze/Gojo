import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export function globalErrorHandler(
  error: FastifyError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply
): any {
  request.log.error(error);

  // Zod validation errors
  if (error instanceof ZodError) {
    reply.code(400).send({
      error: 'Validation Error',
      details: error.issues,
    });
    return;
  }

  // Fastify validation errors
  if ('validation' in error && (error as FastifyError).validation) {
    reply.code(400).send({
      error: 'Validation Error',
      message: error.message,
      details: (error as FastifyError).validation,
    });
    return;
  }

  // Known HTTP errors
  const statusCode = (error as FastifyError).statusCode ?? 500;
  reply.code(statusCode).send({
    error: statusCode >= 500 ? 'Internal Server Error' : error.message,
    ...(statusCode < 500 && { message: error.message }),
  });
}
