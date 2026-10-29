import { z } from 'zod';

/**
 * A saved address.
 *
 * The same shape the booking form already sends, plus a label and a default
 * flag. Validation is deliberately identical to the booking's address schema -
 * an address that cannot be used for a booking is not worth saving.
 */
export const createAddressSchema = z.object({
  label: z.string().trim().min(1).max(40).default('Home'),
  line1: z.string().trim().min(5, 'Enter the full address').max(250),
  line2: z.string().trim().max(250).nullish(),
  landmark: z.string().trim().max(120).nullish(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().trim().regex(/^\d{6}$/, 'A pincode is six digits'),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  isDefault: z.coerce.boolean().default(false),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export default { createAddressSchema, idParamSchema };
