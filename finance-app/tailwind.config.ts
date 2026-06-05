import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Синий — основные действия (как primary-кнопки в референсе)
        brand: {
          DEFAULT: "#2f6df6",
          dark: "#1f4fd0",
        },
        // Оранжевый — фирменный акцент (лого-флёр, бейджи, подсветки)
        accent: {
          DEFAULT: "#f4500a",
          soft: "#fde4d8",
        },
      },
      borderRadius: {
        "4xl": "2rem",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
