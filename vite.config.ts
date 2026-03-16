import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ routesDirectory: "./src/routes" }),
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "#": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "vendor-react", test: /node_modules[\\/](react-dom|react)\//, priority: 20 },
            { name: "vendor-tanstack", test: /node_modules[\\/]@tanstack/, priority: 15 },
            { name: "vendor-ui", test: /node_modules[\\/]@radix-ui/, priority: 10 },
          ],
        },
      },
    },
  },
});
