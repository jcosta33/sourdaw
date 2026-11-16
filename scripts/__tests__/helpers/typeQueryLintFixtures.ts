export const typeQueryLintFixtures = [
    {
        rule: 'sourdaw/no-type-only-private-module-import',
        filename: 'src/modules/Example/useCases/example.ts',
        invalid: "export type Value = typeof import('#/modules/Other/models/Value');",
        valid: "export type Value = typeof import('#/modules/Example/models/Value');",
    },
    {
        rule: 'sourdaw/no-nonmodule-private-module-import',
        filename: 'src/app/example.ts',
        invalid: "export type Value = typeof import('#/modules/Other/useCases/deep');",
        valid: "export type Value = typeof import('#/modules/Other/useCases');",
    },
    {
        rule: 'sourdaw/no-model-layer-upward-import',
        filename: 'src/modules/Example/models/Example.ts',
        invalid: "export type Value = typeof import('#/modules/Other/stores');",
        valid: "export type Value = typeof import('./Value');",
    },
    {
        rule: 'sourdaw/no-react-in-domain-logic',
        filename: 'src/modules/Example/useCases/example.ts',
        invalid: "export type Value = typeof import('react');",
        valid: "export type Value = typeof import('other');",
    },
    {
        rule: 'sourdaw/no-react-import-outside-ui',
        filename: 'src/app/example.ts',
        invalid: "export type Value = typeof import('react');",
        valid: "export type Value = typeof import('other');",
    },
    {
        rule: 'sourdaw/no-repository-usecase-import',
        filename: 'src/modules/Example/repositories/example.ts',
        invalid: "export type Example = typeof import('#/modules/Other/useCases');",
        valid: "export type Example = typeof import('#/modules/Other/events');",
    },
] as const;
