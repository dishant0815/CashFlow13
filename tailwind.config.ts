import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0b1020",
          800: "#11172a",
          700: "#1a2240",
        },
        // mint and coral don't collide with default Tailwind names; safe as single values.
        mint: "#3DF5B0",
        coral: "#FB7185",
        // NOTE: do NOT redefine `violet` here — Tailwind ships a full violet
        // palette (50-950) and a single-value override would shadow all
        // shades. We use `text-violet-300`, `bg-violet-500/20`, etc.
      },
      backgroundImage: {
        "grad-hero":
          "linear-gradient(135deg, #1a0b3d 0%, #1e1b4b 35%, #0f172a 100%)",
        "grad-cta":
          "linear-gradient(135deg, #8B5CF6 0%, #3DF5B0 100%)",
        "grad-card":
          "linear-gradient(160deg, rgba(139,92,246,0.10) 0%, rgba(61,245,176,0.06) 100%)",
        "grad-danger":
          "linear-gradient(135deg, #FB7185 0%, #F43F5E 100%)",
      },
      boxShadow: {
        glow: "0 10px 40px -10px rgba(139,92,246,0.55)",
        glowMint: "0 10px 40px -10px rgba(61,245,176,0.45)",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Inter", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
