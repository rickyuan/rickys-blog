// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://rickys-blog.pages.dev',
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
