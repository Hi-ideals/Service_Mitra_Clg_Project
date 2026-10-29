/**
 * Request schemas for the auth module. Validation runs before any controller,
 * so services can trust their input.
 */
import { z } from 'zod';
import { ROLES } from '../../config/constants.js';
import { OTP_PURPOSE } from '../../services/otp.service.js';

const email = z.string().trim().toLowerCase().email('Enter a valid email address');

const phone = z
  .string()
  .trim()
  .regex(/^[0-9]{10,15}$/, 'Enter a valid phone number (10 to 15 digits)');

/**
 * Passwords must survive a credential-stuffing list, not an arbitrary symbol
 * quota - so the rule is length plus a mix, and nothing more fiddly.
 */
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number');

const fullName = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(120, 'Name must be at most 120 characters');

const otpCode = z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit code');

/**
 * Email is required because it is the channel verification codes travel on.
 * Phone is required because a provider has to be able to call the customer
 * when they are standing outside the building - neither replaces the other.
 */
export const registerSchema = z
  .object({
    // Admin is absent by design: those accounts are provisioned internally.
    role: z.enum([ROLES.CUSTOMER, ROLES.PROVIDER, ROLES.AGENCY]).default(ROLES.CUSTOMER),
    fullName,
    email,
    phone,
    password,
    agencyName: z.string().trim().min(2, 'Enter your agency name').max(120).optional(),
  })
  .superRefine((value, ctx) => {
    // An agency without a business name would be listed to customers under a
    // person's name, which is the opposite of what an agency is for.
    if (value.role === ROLES.AGENCY && !value.agencyName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['agencyName'],
        message: 'Enter your agency name',
      });
    }
  });

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email address or phone number'),
  password: z.string().min(1, 'Enter your password'),
});

/**
 * Either a six-digit authenticator code or a recovery code.
 *
 * Kept as one loose field rather than two: a person typing what is in front of
 * them should not also have to tell the form which kind it is. The service
 * decides by shape.
 */
const twoFactorCode = z.string().trim().min(6).max(20);

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1),
  code: twoFactorCode,
});

export const twoFactorEnrolSchema = z.object({
  setupToken: z.string().min(1),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the six-digit code from your app'),
});

export const twoFactorSetupSchema = z.object({
  password: z.string().min(1, 'Your current password is required'),
});

export const twoFactorEnableSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the six-digit code from your app'),
});

export const twoFactorDisableSchema = z.object({
  password: z.string().min(1, 'Your current password is required'),
  code: twoFactorCode,
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

export const sendOtpSchema = z.object({
  // Accepts either identifier: the code is always sent to the email address
  // on the account, whichever one was used to find it.
  destination: z.string().trim().min(3, 'Enter your email address or phone number'),
  purpose: z
    .enum([OTP_PURPOSE.VERIFY_EMAIL, OTP_PURPOSE.RESET_PASSWORD])
    .default(OTP_PURPOSE.VERIFY_EMAIL),
});

export const confirmContactSchema = z.object({
  destination: z.string().trim().min(3),
  code: otpCode,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: password,
});

export const resetPasswordSchema = z.object({
  destination: z.string().trim().min(3),
  code: otpCode,
  newPassword: password,
});

export const updateProfileSchema = z.object({
  fullName: fullName.optional(),
  avatarUrl: z.string().url('Enter a valid image URL').optional(),
});

export default {
  registerSchema,
  loginSchema,
  refreshSchema,
  sendOtpSchema,
  confirmContactSchema,
  changePasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
};
