import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build config for the GitHub Pages demo (docs/index.html).
 *
 * Everything is inlined into one file so the page can be dropped anywhere
 * with no asset paths to get wrong: assetsInlineLimit is set above the size
 * of the largest asset (the ~33 KB variable font) so Vite emits data URIs,
 * and scripts/build-demo.mjs folds the resulting JS and CSS into the HTML.
 *
 * VITE_DEMO switches the app to hash routing — see client/src/App.jsx.
 */
export default defineConfig({
  root: 'demo',
  plugins: [react()],
  define: { 'import.meta.env.VITE_DEMO': 'true' },
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
    assetsInlineLimit: 512 * 1024,
    cssCodeSplit: false,
    // One JS file and one CSS file, so the inliner has exactly two things to
    // fold in rather than a graph of chunks.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
