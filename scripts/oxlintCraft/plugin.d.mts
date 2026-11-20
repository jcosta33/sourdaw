// Companion declaration for plugin.mjs. The scripts TypeScript project does
// not set `allowJs`, so a plain .mjs import would otherwise resolve to an
// implicit `any` (TS7016).
import type { Rule } from 'eslint';

export type CraftRuleId =
    | 'no-complex-ternary-branch'
    | 'no-conditional-empty-spread'
    | 'no-useless-clone-spread'
    | 'no-spread-clone-array-method'
    | 'no-json-parse-stringify'
    | 'no-long-array-chain'
    | 'no-control-flow-ternary'
    | 'no-conditional-playwright-admission'
    | 'no-external-data-assertion'
    | 'no-failed-operation-success'
    | 'no-fixed-test-sleep'
    | 'no-invalid-vitest-expect'
    | 'no-positional-boolean-flags'
    | 'no-silent-catch';

declare const plugin: {
    meta: { name: string };
    rules: Record<CraftRuleId, Rule.RuleModule>;
};

// oxlint jsPlugins require a default export from plugin.mjs; this file is that module's types.
// oxlint-disable-next-line import/no-default-export -- jsPlugins loads the companion .mjs as default.
export default plugin;
