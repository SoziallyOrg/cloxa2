/** @type {import("prettier").Config} */
const config = {
  endOfLine: "lf",
  plugins: ["prettier-plugin-tailwindcss"],
  printWidth: 88,
  proseWrap: "always",
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  tailwindStylesheet: "./apps/web/src/app/globals.css",
  trailingComma: "all",
};

export default config;
