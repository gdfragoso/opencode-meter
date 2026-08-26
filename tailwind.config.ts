import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cyber: {
          bg: "#0a0a0f",
          cyan: "#00ffcc",
          magenta: "#ff00ff",
          danger: "#ff4466",
        },
      },
      fontFamily: {
        mono: ['"Share Tech Mono"', "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
