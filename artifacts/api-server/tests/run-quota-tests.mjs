import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "guide-quota-"));
try {
  const outfile = join(directory, "daily-usage.test.cjs");
  await build({
    entryPoints: ["tests/daily-usage.test.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["pg-native"],
    define: {
      __ATLANTA_GUIDE_FACTS__: JSON.stringify("Test page facts."),
      "process.env.GEMINI_API_KEY": JSON.stringify("test-only-dummy-key"),
    },
  });
  const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
