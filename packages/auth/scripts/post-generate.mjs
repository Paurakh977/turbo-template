import fs from "node:fs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node post-generate.mjs <path-to-prisma-file>");
  process.exit(1);
}

const content = fs.readFileSync(filePath, "utf-8");
const stripped = content.replace(
  /^\s*(?:generator|datasource)\s+\w+\s*\{[\s\S]*?^\}\s*$/gm,
  "",
);

if (stripped === content) {
  console.log(`[post-generate] No generator/datasource blocks in ${filePath} — nothing to strip.`);
  process.exit(0);
}

fs.writeFileSync(filePath, stripped);
console.log(`[post-generate] Stripped generator/datasource blocks from ${filePath}`);