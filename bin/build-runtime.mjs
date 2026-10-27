import { build } from "esbuild";
import nft from "next/dist/compiled/@vercel/nft/index.js";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
await rm("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/worker.ts", "src/migrate.ts"],
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  packages: "external",
  platform: "node",
  target: "node24",
  format: "esm",
  tsconfig: "tsconfig.json",
});

// Extend Next's standalone tree with only the dependencies of the two CLI entrypoints.
const { fileList, warnings } = await nft.nodeFileTrace(
  ["dist/worker.mjs", "dist/migrate.mjs"],
  { base: root, processCwd: root },
);
for (const warning of warnings) console.warn(warning.message);
const files = [...fileList];
for (let offset = 0; offset < files.length; offset += 32) {
  await Promise.all(
    files.slice(offset, offset + 32).map(async (file) => {
      const destination = path.join(".next/standalone", file);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(file, destination, { recursive: true });
    }),
  );
}
console.log(
  `Prepared compiled worker/migrations and ${files.length} traced runtime files`,
);
