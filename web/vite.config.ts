import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Backend the dev server proxies /api, /bots and /health to. Defaults to the
  // live backend so login/auth run against real data; override with
  // VITE_PROXY_TARGET (e.g. http://localhost:3000) to develop against a local API.
  const target = env.VITE_PROXY_TARGET || "https://20.198.80.63.nip.io";

  // Same-origin proxy (browser only ever sees localhost:5173), so login cookies
  // + CSRF work without any CORS setup. changeOrigin fixes the Host header/SNI
  // for the upstream vhost + TLS; cookieDomainRewrite rebinds the backend's
  // Set-Cookie domain to the dev host so the browser actually stores it.
  const proxyOptions = {
    target,
    changeOrigin: true,
    secure: true,
    cookieDomainRewrite: ""
  };

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { ...proxyOptions },
        "/bots": { ...proxyOptions },
        "/health": { ...proxyOptions }
      }
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      chunkSizeWarningLimit: 800
    }
  };
});
