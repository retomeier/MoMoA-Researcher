import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import babelParser from "@babel/eslint-parser";

export default tseslint.config(
  // 1. Base Ignore
  { ignores: ["dist", "node_modules"] },

  // 2. JavaScript Setup (Enhanced for One-Off/Flow/React files)
  {
    files: ["**/*.{js,mjs,cjs,jsx}"], // Added jsx
    extends: [
      js.configs.recommended
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node, // "One-off" scripts often run in Node contexts too
      },
      sourceType: "module",
      ecmaVersion: "latest", // Parse latest standard JS features
      
      parser: babelParser, 
      parserOptions: {
        requireConfigFile: false, // Essential for one-off files without babelrc
        babelOptions: {
          presets: [
            "@babel/preset-react", // Handles JSX
            "@babel/preset-flow"   // Handles Flow types
          ],
          plugins: [
            // Handles "@decorator" syntax (legacy mode is safest for random files)
            ["@babel/plugin-proposal-decorators", { legacy: true }] 
          ]
        },
      },
    },
    rules: {
      "no-unused-vars": "off", 
      "no-console": "off",
      "prefer-const": "off",
      "no-undef": "off", // Critical for one-off snippets where dependencies aren't visible
      "no-redeclare": "off", // Helpful if pasting multiple snippets together
    }
  },

  // 3. TypeScript Setup (Applies only to TS files)
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      ...tseslint.configs.recommended
    ], 
    languageOptions: {
      globals: { 
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        project: null,
        program: null,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",

      "no-undef": "off",
      "no-console": "off",
      "no-debugger": "off",
      "no-empty": "off",
      "no-constant-condition": "off",
      "no-unreachable": "off",
      "prefer-const": "off",

      "@typescript-eslint/no-namespace": "warn",
      "@typescript-eslint/no-explicit-any": "warn"
    },
  }
);