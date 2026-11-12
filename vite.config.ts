import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      watch: {
        ignored: [
          "**/Backend/localRepoCopy/**",
          "**/Backend/bin/**",
          "**/Backend/obj/**",
          "**/.vs/**",
        ],
      },
      proxy: {
        "/api": {
          target: env.API_PROXY_TARGET || "http://127.0.0.1:62926",
          changeOrigin: true,
        },
      },
    },
  };
});
