import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitest = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [vitest, "run", "src/lib/ai/leakage.real-corpus.test.ts", "--reporter=verbose"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ENEMLAB_REAL_LEAKAGE_EVAL: "1",
    },
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
