import { z } from 'zod';

/**
 * Note what is NOT here: an amount. The client never supplies one - the server
 * reads it off the booking. A body containing an amount is simply ignored.
 */
export const createOrderSchema = z.object({
  bookingId: z.string().uuid('Choose a booking to pay for'),
});

/** The handshake Razorpay checkout hands back to the browser. */
export const verifyCheckoutSchema = z.object({
  bookingId: z.string().uuid(),
  orderId: z.string().min(4),
  paymentId: z.string().min(4),
  signature: z.string().min(16),
});

export const refundSchema = z.object({
  // Omitted means refund everything still refundable.
  amountMinor: z.coerce.number().int().positive('The refund amount must be greater than zero').optional(),
  reason: z.string().trim().min(5, 'Give a reason, at least 5 characters').max(300),
});

export const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier') });

export default { createOrderSchema, verifyCheckoutSchema, refundSchema, listSchema, idParamSchema };
