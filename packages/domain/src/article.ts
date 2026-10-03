import { z } from 'zod';

export const CreateArticleSchema = z.object({
  title: z.string().trim().min(1).max(240),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  excerpt: z.string().max(500).optional(),
  body: z.string().min(1),
  categoryId: z.string().uuid().optional(),
  authorId: z.string().uuid(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'),
});
