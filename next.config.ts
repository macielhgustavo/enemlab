import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Fixa a raiz no diretório web/ (o projeto CRA antigo fica no diretório pai).
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    // Imagens das questões vêm da API pública do ENEM.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
