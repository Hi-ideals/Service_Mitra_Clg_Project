import { z } from 'zod';

export const raiseSchema = z.object({
  bookingId: z.string().uuid('Choose the booking you are disputing'),
  category: z.enum([
    'work_quality', 'incomplete_work', 'damage', 'overcharged',
    'no_show', 'behaviour', 'other',
  ]),
  subject: z.string().trim().min(5, 'Summarise the issue, at least 5 characters').max(150),
  description: z.string().trim().min(20, 'Describe what happened, at least 20 characters').max(2000),
  evidence: z.array(z.string().max(300)).max(8).default([]),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

export const messageSchema = z.object({
  message: z.string().trim().min(2).max(2000),
  attachments: z.array(z.string().max(300)).max(8).default([]),
  // Honoured only for admins; the service forces false for everyone else.
  isInternal: z.coerce.boolean().optional(),
});

export const resolveSchema = z
  .object({
    resolutionType: z.enum(['full_refund', 'partial_refund', 'no_refund', 'rework', 'warning_issued']),
    resolution: z.string().trim().min(10, 'Explain the decision, at least 10 characters').max(1000),
    refundAmountMinor: z.coerce.number().int().positive().optional(),
  })
  .refine((v) => v.resolutionType !== 'partial_refund' || v.refundAmountMinor, {
    message: 'A partial refund needs an amount',
    path: ['refundAmountMinor'],
  });

export const rejectSchema = z.object({
  resolution: z.string().trim().min(10, 'Explain why, at least 10 characters').max(1000),
});

export const listSchema = z.object({
  status: z.enum(['open', 'under_review', 'awaiting_response', 'resolved', 'rejected']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  bookingId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier') });

export default { raiseSchema, messageSchema, resolveSchema, rejectSchema, listSchema, idParamSchema };
