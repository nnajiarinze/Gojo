import { getEmailQueue } from '../queues/index.js';
import { EmailJobPayload } from '../types/jobs.js';

/**
 * Enqueue an email delivery job. The email worker handles
 * actual sending and updates the invoice status to 'sent'.
 */
export async function enqueueEmailJob(params: {
  invoiceId: string;
  to: string;
  subject: string;
  body: string;
}): Promise<{ emailId: string }> {
  const payload: EmailJobPayload = params;

  const job = await getEmailQueue().add('send', payload, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });

  return { emailId: job.id! };
}
