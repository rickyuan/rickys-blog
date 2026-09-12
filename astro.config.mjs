// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://blog.tarnlab.com',
  output: 'server',
  adapter: cloudflare(),
  integrations: [mdx()],
  vite: {
    resolve: {
      alias: import.meta.env.PROD
        ? { 'react-dom/server': 'react-dom/server.edge' }
        : {},
    },
  },
});
