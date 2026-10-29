import { z } from 'zod';

const minor = z.coerce.number().int().min(0, 'Amount cannot be negative');

const base = {
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, 'Slug may contain lowercase letters, numbers and hyphens').max(80).optional(),
  parentId: z.string().uuid().nullish(),
  description: z.string().trim().max(1000).nullish(),
  icon: z.string().trim().max(60).nullish(),
  imageUrl: z.string().url().nullish(),
  basePriceMinor: minor,
  minPriceMinor: minor,
  maxPriceMinor: minor.nullish(),
  pricingUnit: z.enum(['per_visit', 'per_hour', 'per_unit', 'quote_on_inspection']).default('per_visit'),
  estimatedMinutes: z.coerce.number().int().min(5).max(1440).default(60),
  commissionPercent: z.coerce.number().min(0).max(100).nullish(),
  requiresCertification: z.coerce.boolean().default(false),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.coerce.boolean().default(true),
};

export const createCategorySchema = z.object(base);

export const updateCategorySchema = z
  .object({
    ...base,
    name: base.name.optional(),
    basePriceMinor: minor.optional(),
    minPriceMinor: minor.optional(),
    pricingUnit: base.pricingUnit.optional(),
    estimatedMinutes: base.estimatedMinutes.optional(),
    requiresCertification: z.coerce.boolean().optional(),
    displayOrder: z.coerce.number().int().min(0).optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });

export const listCategoriesSchema = z.object({
  parentId: z.string().uuid().optional(),
  rootOnly: z.coerce.boolean().optional(),
  includeInactive: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier') });

export const slugParamSchema = z.object({
  idOrSlug: z.string().trim().min(1).max(80),
});

export default {
  createCategorySchema,
  updateCategorySchema,
  listCategoriesSchema,
  idParamSchema,
  slugParamSchema,
};
