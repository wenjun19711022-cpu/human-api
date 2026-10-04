import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// React and ReactDOM load as pinned UMD builds from cdnjs (see index.html); the app itself is inlined
// into one HTML file so the same build runs on GitHub Pages, any static host, or as a single page.
export default defineConfig({
  base: "./",
  esbuild: {
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
  },
  plugins: [viteSingleFile()],
  build: {
    target: "es2020",
    rollupOptions: {
      external: ["react", "react-dom", "react-dom/client"],
      output: {
        format: "iife",
        globals: { react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM" },
      },
    },
  },
});
