import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
// https://vite.dev/config/
export default defineConfig({
    base: "./",
    plugins: [react()],
    build: {
        outDir: path.resolve(__dirname, "../media/scenario/dist"),
        emptyOutDir: true,
        sourcemap: false
    }
});
//# sourceMappingURL=vite.config.js.map