// Companion declaration for oxlint.craft-baseline.mjs. The root TypeScript
// projects do not set `allowJs`, so a plain .mjs import would otherwise
// resolve to an implicit `any` (TS7016) wherever it is imported from a
// type-checked file — this file supplies the real type instead.
export declare const craftRuleIds: readonly [
    'no-conditional-empty-spread',
    'no-useless-clone-spread',
    'no-spread-clone-array-method',
    'no-json-parse-stringify',
    'no-long-array-chain',
    'no-control-flow-ternary',
];

export declare const craftBaselineFiles: Record<(typeof craftRuleIds)[number], string[]>;
