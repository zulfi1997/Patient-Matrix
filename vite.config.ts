import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Project pages are served from /<repo>/, so the build needs that base path;
  // local dev keeps serving from / (set via GITHUB_PAGES env in the deploy workflow).
  base: process.env.GITHUB_PAGES ? '/Patient-Matrix/' : '/',
  plugins: [react(), tailwindcss()],
})
