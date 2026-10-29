import { z } from 'zod';

const star = z.coerce.number().int().min(1, 'Rate between 1 and 5').max(5, 'Rate between 1 and 5');

export const createReviewSchema = z.object({
  bookingId: z.string().uuid('Choose the booking you are reviewing'),
  rating: star,
  title: z.string().trim().max(120).nullish(),
  comment: z.string().trim().max(2000).nullish(),
  punctuality: star.optional(),
  quality: star.optional(),
  behaviour: star.optional(),
  photos: z.array(z.string().max(300)).max(6).default([]),
});

export const replySchema = z.object({
  reply: z.string().trim().min(5, 'Write at least a few words').max(1000),
});

export const reportSchema = z.object({
  reason: z.enum(['spam', 'abusive', 'fake', 'irrelevant', 'personal_information', 'other']),
  details: z.string().trim().max(500).nullish(),
});

export const moderateSchema = z.object({
  status: z.enum(['published', 'hidden', 'removed']),
  reason: z.string().trim().max(500).nullish(),
});

export const providerReviewsSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  withPhotos: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const queueSchema = z.object({
  status: z.enum(['flagged', 'hidden', 'removed', 'published']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier') });

export default {
  createReviewSchema, replySchema, reportSchema, moderateSchema,
  providerReviewsSchema, queueSchema, listSchema, idParamSchema,
};
