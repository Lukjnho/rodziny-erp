import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Versión del build: hash del commit en Vercel, o 'dev' en local.
// Se hornea en el bundle (__APP_VERSION__) y se publica en /version.json
// para que la app detecte cuando salió un deploy nuevo y avise al usuario.
const APP_VERSION = process.env.VERCEL_GIT_COMMIT_SHA || 'dev'

// Emite version.json en la raíz de dist con la versión del build actual.
function versionJsonPlugin(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: APP_VERSION }),
      })
    },
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react(), versionJsonPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('xlsx') || id.includes('papaparse')) return 'sheets';
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('@tanstack')) return 'tanstack';
          if (id.includes('react-router')) return 'router';
          if (id.includes('react-dom') || id.includes('scheduler')) return 'react-dom';
          if (id.includes('react/')) return 'react';
          return undefined;
        },
      },
    },
  },
})
