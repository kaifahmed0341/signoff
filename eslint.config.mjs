import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    ".next-e2e/**",
    "data/**",
    "test-results/**",
  ]),
  {
    // Safety model, enforced: the AI code cannot import the payment rail or the Braintree SDKs.
    files: ["src/lib/ai/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/payments", "**/payments/*", "@/lib/payments", "@/lib/payments/*"], message: "The AI checker must not reach the payment rail. Money moves only from a person's click." },
            { group: ["braintree", "braintree-web-drop-in"], message: "The AI checker must not import a payment SDK." },
          ],
        },
      ],
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
]);

export default eslintConfig;
