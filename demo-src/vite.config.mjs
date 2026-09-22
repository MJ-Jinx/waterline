import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// Builds the Full Demo bundle into site/assets/demo/.
//
// The site is otherwise a no-build static directory and stays that way: this
// produces plain files GitHub Pages serves like any other asset, and only
// demo.html loads them. /check keeps its "nothing to download" property.
export default defineConfig({
  // Relative, because Pages serves this site from /waterline/ rather than /.
  base: './',
  plugins: [wasm()],
  // The worker needs the same wasm handling; Vite does not inherit plugins.
  worker: { format: 'es', plugins: () => [wasm()] },
  build: {
    // Top-level await is native from es2022 and the wasm glue depends on it.
    // The swc-based top-level-await plugin fails on this bundle, and is not
    // needed for any browser we care about.
    target: 'es2022',
    outDir: '../site/assets/demo',
    emptyOutDir: true,
    rollupOptions: {
      input: './main.js',
      output: {
        entryFileNames: 'demo.js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name]-[hash][extname]',
      },
    },
  },
});
