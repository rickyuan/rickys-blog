import { defineCollection } from 'astro:content';
import { z } from 'astro:schema';
import { glob } from 'astro/loaders';

const dossiers = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/dossiers' }),
  schema: z.object({
    title: z.string(),
    title_cn: z.string().optional(),
    description: z.string(),
    description_en: z.string().optional(),
    category: z.enum(['culture', 'sports', 'tech']),
    pubDate: z.coerce.date(),
    bilingual: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const sgLife = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/sg-life' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = {
  dossiers,
  'sg-life': sgLife,
};
