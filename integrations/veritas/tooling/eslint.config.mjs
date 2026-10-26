import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      ...eslint.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-debugger": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-throw-literal": "error",
      "no-unsafe-finally": "error",
      "no-unreachable-loop": "error",
      "eqeqeq": ["error", "always"],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          "fixStyle": "separate-type-imports"
        }
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          "argsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ]
    }
  }
];
