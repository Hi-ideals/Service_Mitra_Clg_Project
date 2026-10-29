import { z } from 'zod';
import { BOOKING_STATUS as S } from '../../config/constants.js';

const addressSchema = z.object({
  line: z.string().trim().min(5, 'Enter the full address').max(250),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^[0-9]{6}$/, 'Enter a valid 6-digit pincode'),
  lat: z.coerce.number().min(-90).max(90).nullish(),
  lng: z.coerce.number().min(-180).max(180).nullish(),
});

export const createBookingSchema = z.object({
  providerId: z.string().uuid('Choose a provider'),
  /**
   * One booking, one or more services.
   *
   * `categoryId` is kept so an older client keeps working; `categoryIds` wins
   * when both arrive. The cap guards against a request that would reserve most
   * of a working day in one go - eight services at the catalogue's longest
   * estimate is already a full shift.
   */
  categoryIds: z
    .array(z.string().uuid('Choose a service'))
    .min(1, 'Choose at least one service')
    .max(8, 'Choose up to 8 services for one visit')
    .optional(),
  categoryId: z.string().uuid('Choose a service').optional(),
  scheduledStart: z.string().datetime({ offset: true, message: 'Provide an ISO date-time with a timezone' }),
  // The saved address the customer picked, kept for reference. The snapshot
  // below is what the booking actually records.
  addressId: z.string().uuid().nullish(),
  address: addressSchema,
  description: z.string().trim().max(1000).nullish(),
  customerNotes: z.string().trim().max(500).nullish(),
}).refine((v) => (v.categoryIds?.length ?? 0) > 0 || Boolean(v.categoryId), {
  message: 'Choose at least one service',
  path: ['categoryIds'],
});

export const rejectSchema = z.object({
  reason: z.string().trim().min(5, 'Tell the customer why, at least 5 characters').max(300),
});

export const cancelSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason, at least 5 characters').max(300),
});

export const rescheduleSchema = z.object({
  scheduledStart: z.string().datetime({ offset: true, message: 'Provide an ISO date-time with a timezone' }),
  reason: z.string().trim().max(300).nullish(),
});

const statusValues = Object.values(S);

export const listSchema = z.object({
  status: z
    .union([z.enum(statusValues), z.array(z.enum(statusValues))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  search: z.string().trim().min(2).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid booking identifier') });

export default {
  createBookingSchema, rejectSchema, cancelSchema, rescheduleSchema, listSchema, idParamSchema,
};
