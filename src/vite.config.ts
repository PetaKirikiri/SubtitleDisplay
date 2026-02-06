import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  // Load env vars from .env file (root directory)
  const env = loadEnv(mode, resolve(__dirname, '..'), '');
  
  // Source directory: src/
  const sourceDir = resolve(__dirname);
  // Output directory: extension/ (build output folder)
  const outputDir = resolve(__dirname, '../extension');
  
  return {
    root: sourceDir,
    build: {
      outDir: resolve(outputDir, 'dist'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          content: resolve(sourceDir, 'content.ts'),
          background: resolve(sourceDir, 'background.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
          assetFileNames: 'styles/[name].[ext]',
          format: 'es', // ES modules (Manifest V3 supports this)
        },
      },
      watch: process.env.WATCH === 'true' ? {} : null,
    },
    resolve: {
      alias: {
        '@': resolve(__dirname),
      },
      preserveSymlinks: false,
    },
    optimizeDeps: {
      include: ['@supabase/supabase-js', 'zod'],
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL || 'https://gbsopnbovsxlstnmaaga.supabase.co'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY || '[YOUR-ANON-KEY]'),
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'copy-manifest',
        closeBundle() {
          // Copy manifest.json to extension/dist/ (where Chrome loads from)
          const distDir = resolve(outputDir, 'dist');
          if (!existsSync(distDir)) {
            mkdirSync(distDir, { recursive: true });
          }
          copyFileSync(resolve(sourceDir, 'manifest.json'), resolve(distDir, 'manifest.json'));
        },
      },
    ],
  };
});
