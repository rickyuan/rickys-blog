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

const onroad = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/onroad' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['sg-local', 'overseas']),
    origin: z.string(),
    destination: z.string(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    cover: z.string().default('🧭'),
    status: z.enum(['planning', 'ready', 'done']).default('planning'),
    guide: z.string().optional(), // id of a `guides` entry to cross-link (e.g. bird-paradise)
    draft: z.boolean().default(false),
  }),
});

// Field guides built from photos of the on-site info signs: one entry per
// park / visit, species data lives in the frontmatter so a guide is a single
// self-contained file. Rendered at /guides/<id>.
const IUCN = z.enum(['LC', 'NT', 'VU', 'EN', 'CR', 'EW', 'EX', 'DD', 'NE']);

const guides = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    title_en: z.string().optional(),
    description: z.string(),
    park: z.string(),
    cover: z.string().default('📖'),
    visitDate: z.coerce.date().optional(),
    trip: z.string().optional(), // id of the `onroad` entry this guide belongs to
    draft: z.boolean().default(false),
    zones: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          pinyin: z.string().optional(), // 分区名拼音,空格分隔,一个汉字一个音节
          name_en: z.string().optional(),
          note: z.string().optional(),
        }),
      )
      .default([]),
    species: z
      .array(
        z.object({
          id: z.string(),
          cn: z.string(),
          // 拼音:空格分隔的音节,数量必须等于中文名里的汉字数(非汉字不占音节)。
          // 渲染时逐字对齐成 ruby 注音;数量对不上就整体不注音,宁可不注也不注错。
          pinyin: z.string().optional(),
          en: z.string(),
          sci: z.string().optional(),
          zone: z.string().optional(), // zone id
          emoji: z.string().optional(),
          family: z.string().optional(),
          family_pinyin: z.string().optional(),
          size: z.string().optional(),
          diet: z.string().optional(),
          range: z.string().optional(),
          iucn: IUCN.optional(),
          facts: z.array(z.string()).default([]), // 中文要点
          kids: z.string().optional(), // 给娃的一句话
          en_text: z.string().optional(), // 原牌英文摘录,方便对照学英文
          photo: z.string().optional(), // 鸟的照片
          sign: z.string().optional(), // 介绍牌照片
          tags: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  }),
});

export const collections = {
  dossiers,
  'sg-life': sgLife,
  onroad,
  guides,
};
