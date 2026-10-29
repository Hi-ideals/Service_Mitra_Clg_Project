import { z } from 'zod';

export const updateAgencySchema = z.object({
  name: z.string().trim().min(2, 'Enter your agency name').max(120).optional(),
  headline: z.string().trim().max(140).nullish(),
  about: z.string().trim().max(1500).nullish(),
  registrationNo: z.string().trim().max(60).nullish(),
  addressLine: z.string().trim().max(250).nullish(),
  city: z.string().trim().max(80).nullish(),
  state: z.string().trim().max(80).nullish(),
  pincode: z.string().regex(/^[0-9]{6}$/, 'Enter a valid 6-digit pincode').nullish(),
});

/**
 * Adding a provider to the agency.
 *
 * The password rules match self-registration exactly. An agency setting a
 * weak password for someone else is the same risk as that person choosing
 * one, except the person never agreed to it.
 */
export const addProviderSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter their full name').max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Enter a valid email address')
    .max(160),
  phone: z
    .string()
    .trim()
    .regex(/^[6-9][0-9]{9}$/, 'Enter a 10-digit Indian mobile number'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/[0-9]/, 'Password must include a number'),
  headline: z.string().trim().max(140).optional(),
});

export const providerStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
  reason: z.string().trim().max(300).optional(),
});

export const bookingListSchema = z.object({
  status: z
    .enum(['requested', 'accepted', 'in_progress', 'completed', 'rejected', 'cancelled', 'disputed', 'refunded'])
    .optional(),
  providerId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier') });

export default {
  updateAgencySchema, addProviderSchema, providerStatusSchema,
  bookingListSchema, idParamSchema,
};
