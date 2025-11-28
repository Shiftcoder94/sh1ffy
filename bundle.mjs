// bundle.mjs
import { build } from "esbuild";

await build({
  entryPoints: ["./src/extension.ts"],  // adjust if your extension.ts is elsewhere
  bundle: true,
  platform: "node",
  format: "cjs",
  target: ["node16"],                   // VS Code's runtime Node version (16+)
  outfile: "out/extension.js",
  sourcemap: true,

  // Only "vscode" should be external. Everything else (adm-zip, jsonc-parser, etc.)
  // gets bundled into out/extension.js.
  external: ["vscode"],

  // These help esbuild resolve modern packages correctly
  mainFields: ["module", "main"],
});