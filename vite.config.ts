import { defineConfig } from 'vite';
import { viteGoesGlmPlugin } from './server/viteGoesGlmPlugin';
import { viteGoes18GlmPlugin } from './server/viteGoes18GlmPlugin';
import { viteMtgLiPlugin } from './server/viteMtgLiPlugin';
import { viteRegionalFeedsPlugin } from './server/viteRegionalFeedsPlugin';
import { viteUnifiedHubPlugin } from './server/viteUnifiedHubPlugin';

export default defineConfig({
  plugins: [
    viteUnifiedHubPlugin(),
    viteGoesGlmPlugin(),
    viteGoes18GlmPlugin(),
    viteMtgLiPlugin(),
    viteRegionalFeedsPlugin()
  ],
  server: {
    port: 3005,
    open: false
  },
  build: {
    target: 'esnext'
  },
  optimizeDeps: {
    include: ['three', 'three-globe']
  }
});
