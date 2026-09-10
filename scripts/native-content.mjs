import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const publish = args.includes("--publish");
const file = args.find((arg) => !arg.startsWith("--"));
if (!file || args.some((arg) => arg.startsWith("--") && arg !== "--publish")) {
  throw new Error("Usage: npm run native:validate -- <bundle.json> [--publish]");
}

const server = await createServer({
  root,
  configFile: false,
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: "custom",
  resolve: { alias: { "@": path.join(root, "src") } },
});

try {
  const {
    nativeBundleSchema,
    nativeManifestSchema,
    applyNativeBundle,
    editionKey,
    nativeCoverage,
  } = await server.ssrLoadModule("/src/lib/native/bundle.ts");
  const { getProvider } = await server.ssrLoadModule("/src/lib/providers/index.ts");
  const { markdownImageUrls } = await server.ssrLoadModule("/src/lib/format.ts");
  const bundle = nativeBundleSchema.parse(
    JSON.parse(await readFile(path.resolve(file), "utf8")),
  );
  if (bundle.providerId === "enem")
    throw new Error("ENEM already uses its native API pipeline");
  const questions = await getProvider(bundle.providerId).fetchQuestions({
    year: bundle.year,
    editionId: bundle.editionId ?? undefined,
    nativeContent: false,
  });
  applyNativeBundle(questions, bundle);
  for (const question of bundle.questions) {
    const text = [
      question.statement,
      question.context,
      question.alternativesIntroduction,
      ...question.alternatives.map((alternative) => alternative.text),
    ]
      .filter(Boolean)
      .join("\n");
    const media = [
      ...markdownImageUrls(text),
      ...(question.files ?? []),
      ...question.alternatives.flatMap((alternative) =>
        alternative.file ? [alternative.file] : [],
      ),
    ];
    for (const asset of media.filter((url) => url.startsWith("/native/assets/"))) {
      await readFile(path.join(root, "public", asset));
    }
  }
  const bytes = JSON.stringify(bundle, null, 2) + "\n";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const entry = {
    providerId: bundle.providerId,
    year: bundle.year,
    editionId: bundle.editionId,
    path: `/native/editions/${sha256}.json`,
    sha256,
    questionCount: bundle.questions.length,
    coverage: nativeCoverage(bundle),
  };
  const manifestPath = path.join(root, "public/native/manifest.json");
  const manifest = nativeManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  manifest.entries = [
    ...manifest.entries.filter((item) => editionKey(item) !== editionKey(entry)),
    entry,
  ].sort((left, right) => editionKey(left).localeCompare(editionKey(right)));
  nativeManifestSchema.parse(manifest);
  if (publish) {
    await mkdir(path.join(root, "public/native/editions"), { recursive: true });
    await writeFile(path.join(root, "public", entry.path), bytes);
    const temporary = `${manifestPath}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n");
    await rename(temporary, manifestPath);
  }
  process.stdout.write(
    JSON.stringify({ status: publish ? "published" : "validated", ...entry }) + "\n",
  );
} finally {
  await server.close();
}
