import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#2f6df6",
          dark: "#1f4fd0",
        },
      },
    },
  },
  plugins: [],
};

export default config;
