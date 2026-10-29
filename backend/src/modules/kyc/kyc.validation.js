import { z } from 'zod';
import { VERIFICATION_STATUS } from '../../config/constants.js';

export const submitSchema = z.object({
  fullLegalName: z.string().trim().min(3, 'Enter your full name as printed on your ID').max(150),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD')
    .refine((d) => {
      const age = (Date.now() - new Date(d).getTime()) / (365.25 * 86400000);
      return age >= 18 && age <= 90;
    }, 'You must be at least 18 years old to offer services')
    .nullish(),
  idProofType: z.enum(['aadhaar', 'pan', 'voter_id', 'passport', 'driving_licence']),
  idProofLast4: z.string().regex(/^[0-9]{4}$/, 'Enter the last 4 digits of your ID number'),
  addressLine: z.string().trim().min(5).max(250),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  pincode: z.string().regex(/^[0-9]{6}$/, 'Enter a valid 6-digit pincode'),
});

export const documentSchema = z.object({
  docType: z.enum(['identity', 'address', 'trade_certificate', 'photo', 'other']),
});

export const queueSchema = z.object({
  status: z.enum([
    VERIFICATION_STATUS.PENDING,
    VERIFICATION_STATUS.INFO_REQUESTED,
    VERIFICATION_STATUS.APPROVED,
    VERIFICATION_STATUS.REJECTED,
    VERIFICATION_STATUS.SUSPENDED,
  ]).optional(),
  search: z.string().trim().min(2).max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const approveSchema = z.object({
  notes: z.string().trim().max(1000).nullish(),
  // Trade licences expire; recording it here sends the provider back for
  // re-verification when the date passes.
  expiresAt: z.string().datetime().nullish(),
});

export const rejectSchema = z.object({
  reason: z.string().trim().min(10, 'Give the provider a usable reason, at least 10 characters').max(500),
  notes: z.string().trim().max(1000).nullish(),
});

export const requestInfoSchema = z.object({
  message: z.string().trim().min(10, 'Explain what is needed, at least 10 characters').max(500),
});

export const providerStatusSchema = z.object({
  status: z.enum([VERIFICATION_STATUS.SUSPENDED, VERIFICATION_STATUS.APPROVED]),
  reason: z.string().trim().min(5).max(500).nullish(),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier') });

// ct and name are optional but signed: they carry the type and filename the
// file was uploaded with, so it can be served as what it actually is.
export const signedFileSchema = z.object({
  key: z.string().min(1).max(300),
  expires: z.string().regex(/^\d+$/),
  ct: z.string().max(100).regex(/^[\w.+-]+\/[\w.+-]+$/, 'Invalid content type').optional(),
  name: z.string().max(120).optional(),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});

export default {
  submitSchema, documentSchema, queueSchema, approveSchema, rejectSchema,
  requestInfoSchema, providerStatusSchema, idParamSchema, signedFileSchema,
};
