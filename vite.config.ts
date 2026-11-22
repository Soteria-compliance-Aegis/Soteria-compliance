import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/*
  The workspace talks to `server.py` (FastAPI + the Python audit engine) on
  port 8000. `npm run build` emits the static workspace that same server
  serves, so running the product is one `python server.py`.
*/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5303,
    strictPort: false,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
