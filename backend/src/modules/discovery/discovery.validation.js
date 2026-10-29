import { z } from 'zod';

export const searchSchema = z
  .object({
    q: z.string().trim().min(2, 'Search for at least 2 characters').max(80).optional(),
    categoryId: z.string().uuid().optional(),
    categorySlug: z.string().trim().max(80).optional(),
    city: z.string().trim().max(80).optional(),
    pincode: z.string().regex(/^[0-9]{6}$/, 'Enter a valid 6-digit pincode').optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(1).max(100).optional(),
    minPriceMinor: z.coerce.number().int().min(0).optional(),
    maxPriceMinor: z.coerce.number().int().min(0).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    minExperience: z.coerce.number().int().min(0).max(70).optional(),
    sort: z.enum(['relevance', 'rating', 'price_low', 'price_high', 'experience', 'distance']).default('relevance'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  // Latitude without longitude silently returns unsorted results, which looks
  // like a bug to the caller - so it is rejected instead.
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'Provide both lat and lng, or neither',
    path: ['lat'],
  })
  .refine(
    (v) => v.minPriceMinor === undefined || v.maxPriceMinor === undefined || v.maxPriceMinor >= v.minPriceMinor,
    { message: 'The maximum price cannot be lower than the minimum price', path: ['maxPriceMinor'] },
  )
  .refine((v) => v.sort !== 'distance' || v.lat !== undefined, {
    message: 'Sorting by distance needs lat and lng',
    path: ['sort'],
  });

export const profileParamSchema = z.object({ id: z.string().uuid('Invalid provider identifier') });

export const profileQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(30).default(7),
  /**
   * How long the visit needs, in minutes.
   *
   * Slots are generated at the shortest service's length by default. Once a
   * customer has chosen several services the visit is longer than that, and
   * offering slots too short to hold it would show times that then fail
   * validation at the last step of the booking flow. The client sends the
   * total so the grid it sees is the grid it can actually book.
   */
  minutes: z.coerce.number().int().min(5).max(600).optional(),
});

export const featuredSchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
  city: z.string().trim().max(80).optional(),
});

export const suggestSchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters').max(60),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export default {
  searchSchema, profileParamSchema, profileQuerySchema, featuredSchema, suggestSchema,
};
