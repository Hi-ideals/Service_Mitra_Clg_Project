import { z } from 'zod';

export const completionCodeSchema = z.object({
  // Set when the job turned out to cost more or less than quoted. The customer
  // sees this amount in the code message before they read it out.
  finalAmountMinor: z.coerce.number().int().min(0).optional(),
});

export const completeSchema = z.object({
  otp: z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit completion code').optional(),
  finalAmountMinor: z.coerce.number().int().min(0).optional(),
  photos: z.array(z.string().max(300)).max(10).default([]),
});

export default { completionCodeSchema, completeSchema };
