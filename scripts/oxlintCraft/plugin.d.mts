// Companion declaration for plugin.mjs. The scripts TypeScript project does
// not set `allowJs`, so a plain .mjs import would otherwise resolve to an
// implicit `any` (TS7016).
export declare const relativeFilename: (filename: string) => string;
export declare const isCraftBaselineFile: (filename: string, ruleId: string) => boolean;

export type CraftRuleId =
    | 'no-conditional-empty-spread'
    | 'no-useless-clone-spread'
    | 'no-spread-clone-array-method'
    | 'no-json-parse-stringify'
    | 'no-long-array-chain'
    | 'no-control-flow-ternary';

declare const plugin: {
    meta: { name: string };
    rules: Record<
        CraftRuleId,
        {
            meta: object;
            create: (context: unknown) => object;
        }
    >;
};

export default plugin;
