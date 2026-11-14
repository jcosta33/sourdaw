// @vitest-environment node

import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { ESLint, Linter } from 'eslint';
import * as parser from '@typescript-eslint/parser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPreparedNativeTypeScriptPath } from '../nativeTypeScript/compiler.mjs';
import { nativeLintLifecycle } from '../nativeTypeScript/lintLifecycle.mjs';

const repository = process.cwd();
let fixtureRoot: string;
let project: string;
let filename: string;

function put(path: string, text: string): string {
    const target = join(fixtureRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    return target;
}

beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'sourdaw-native-lint-'));
    project = put(
        'tsconfig.json',
        JSON.stringify({
            compilerOptions: {
                target: 'ESNext',
                module: 'ESNext',
                moduleResolution: 'Bundler',
                strict: true,
                jsx: 'react-jsx',
                noEmit: true,
                paths: {
                    '#/*': ['./src/*'],
                    react: [resolve(repository, 'node_modules/@types/react/index.d.ts')],
                    'react/jsx-runtime': [resolve(repository, 'node_modules/@types/react/jsx-runtime.d.ts')],
                },
            },
            include: ['src'],
        })
    );
    filename = put('src/modules/Consumer/presentations/views/Panel.tsx', 'export {};');
});

afterEach(() => {
    parser.clearCaches();
    rmSync(fixtureRoot, { recursive: true, force: true });
});

function parsed(code: string) {
    return parser.parseForESLint(code, {
        filePath: filename,
        project,
        tsconfigRootDir: fixtureRoot,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        nativeCompilerPath: getPreparedNativeTypeScriptPath(),
    });
}

async function messages(code: string, namingTypes = false) {
    // Resolve the real app configuration for a production TSX path, preserving
    // its plugins and every enabled rule. Only the fixture's project changes.
    const eslint = new ESLint({ cwd: repository });
    const config = await eslint.calculateConfigForFile(
        resolve(repository, 'src/modules/Arrangement/presentations/views/Panel.tsx')
    );
    expect(config).toBeDefined();
    if (!config?.languageOptions) throw new Error('Production lint configuration was not resolved');
    const result = new Linter({ cwd: fixtureRoot }).verify(
        code,
        {
            plugins: config.plugins,
            rules: config.rules,
            settings: config.settings,
            linterOptions: config.linterOptions,
            ...(config.processor ? { processor: config.processor } : {}),
            files: ['**/*.{ts,tsx}'],
            ...(namingTypes
                ? {
                      rules: {
                          ...config.rules,
                          '@typescript-eslint/naming-convention': [
                              'error',
                              {
                                  selector: 'variable',
                                  types: ['boolean'],
                                  format: ['camelCase'],
                                  prefix: ['is'],
                              },
                          ],
                      },
                  }
                : {}),
            languageOptions: {
                ...config.languageOptions,
                parserOptions: { ...config.languageOptions.parserOptions, project, tsconfigRootDir: fixtureRoot },
            },
        },
        { filename }
    );
    expect(result.filter((message) => message.fatal)).toEqual([]);
    return result;
}

async function customStoreMessages(code: string) {
    const config = await new ESLint({ cwd: repository }).calculateConfigForFile(
        resolve(repository, 'src/modules/Arrangement/presentations/views/Panel.tsx')
    );
    if (!config?.plugins?.sourdaw) throw new Error('Production custom rules were not resolved');
    return new Linter({ cwd: fixtureRoot }).verify(
        code,
        {
            files: ['**/*.{ts,tsx}'],
            languageOptions: { parser, parserOptions: { project: false, sourceType: 'module' } },
            plugins: { sourdaw: config.plugins.sourdaw },
            rules: { 'sourdaw/no-foreign-store-write': 'error' },
        },
        { filename }
    );
}

describe('native typed ESLint integration', () => {
    it('keeps JSDoc between JavaScript tokens in comments while retaining JSX whitespace tokens', () => {
        const code =
            'const before = 1;\n/** @type {number} */\nconst after = 2;\n/** @returns {number} */\nfunction read() { return after; }';
        const result = parser.parseForESLint(code, { filePath: join(fixtureRoot, 'documented.mjs'), project: false });
        expect(result.ast.comments?.map((comment) => comment.value)).toEqual([
            '* @type {number} ',
            '* @returns {number} ',
        ]);
        expect(result.ast.tokens?.map((token) => token.value)).toEqual([
            'const',
            'before',
            '=',
            '1',
            ';',
            'const',
            'after',
            '=',
            '2',
            ';',
            'function',
            'read',
            '(',
            ')',
            '{',
            'return',
            'after',
            ';',
            '}',
        ]);
        const jsx = 'const view = <div>   <span />tail</div>;';
        const whitespace = parser.parseForESLint(jsx, {
            filePath: join(fixtureRoot, 'documented.jsx'),
            project: false,
            ecmaFeatures: { jsx: true },
        });
        expect(whitespace.ast.tokens?.filter((token) => token.type === 'JSXText').map((token) => token.value)).toEqual([
            '   ',
            'tail',
        ]);
        for (const token of whitespace.ast.tokens ?? []) expect(jsx.slice(...token.range)).toBe(token.value);
    });

    it('parses genuine native syntax without a prepared compiler cache', () => {
        const previous = process.env.SOURDAW_NATIVE_TS_CACHE;
        process.env.SOURDAW_NATIVE_TS_CACHE = join(fixtureRoot, 'not-prepared');
        try {
            const result = parser.parseForESLint('export const syntax = 1;', {
                filePath: filename,
                project: false,
                sourceType: 'module',
            });
            expect(result.services.hasTypeInformation).toBe(false);
            expect(result.ast.body[0].type).toBe('ExportNamedDeclaration');
            function literal(code: string, filePath: string) {
                const parsed = parser.parseForESLint(code, { filePath, project: false });
                const declaration = parsed.ast.body[0];
                if (declaration.type !== 'VariableDeclaration') throw new Error('fixture declaration shape changed');
                const value = declaration.declarations[0].init;
                if (value?.type !== 'Literal') throw new Error('fixture literal shape changed');
                return value.value;
            }
            expect(literal('const tone = 1;', filename)).toBe(1);
            expect(literal('const tone = 2;', filename)).toBe(2);
            expect(literal('const other = 3;', join(fixtureRoot, 'other.ts'))).toBe(3);
        } finally {
            if (previous === undefined) delete process.env.SOURDAW_NATIVE_TS_CACHE;
            else process.env.SOURDAW_NATIVE_TS_CACHE = previous;
        }
    });

    it('uses the supplied text and real checker, retaining bidirectional AST identity', () => {
        writeFileSync(filename, 'const tone = 13;');
        const result = parsed("const tone = 'fresh' as const;");
        // The cast is deliberately absent here: the public parser declarations
        // must expose the native service contract before this spec can compile.
        const services = result.services;
        if (!services.hasTypeInformation) throw new Error('Expected real native checker services');
        expect(services.checker).toBe(services.project.checker);
        const statement = result.ast.body[0];
        expect(statement.type).toBe('VariableDeclaration');
        if (statement.type !== 'VariableDeclaration') throw new Error('fixture AST shape changed');
        const id = statement.declarations[0].id;
        const native = services.esTreeNodeToTSNodeMap.get(id);
        expect(native).toBeDefined();
        if (!native) throw new Error('native mapping missing');
        expect(services.tsNodeToESTreeNodeMap.get(native)).toBe(id);
        const type = services.getTypeAtLocation(id);
        expect(type.isStringLiteralType()).toBe(true);
        expect(type.value).toBe('fresh');
        services.dispose();
        expect(() => services.getTypeAtLocation(id)).toThrow('released');
    });

    it('converts native member postfix markers, import phases, generic defaults and complete token ranges', () => {
        const code = `// source comment
import type { Shape } from "shape";
interface Box<Value = string> { value?: Value; read?(): Value; }
class Instrument { value!: string; read?(): string; }
const match = /tone+/u;
const view = <div>{match.test("tone") ? "yes" : "no"}</div>;
`;
        const result = parser.parseForESLint(code, {
            filePath: filename,
            project: false,
            sourceType: 'module',
            ecmaFeatures: { jsx: true },
        });
        expect(result.services.hasTypeInformation).toBe(false);
        const imported = result.ast.body[0];
        if (imported.type !== 'ImportDeclaration') throw new Error('fixture import shape changed');
        expect(imported.importKind).toBe('type');
        const box = result.ast.body[1];
        if (box.type !== 'TSInterfaceDeclaration') throw new Error('fixture interface shape changed');
        expect(box.typeParameters?.params[0].default?.type).toBe('TSStringKeyword');
        const property = box.body.body[0];
        const method = box.body.body[1];
        if (property.type !== 'TSPropertySignature' || method.type !== 'TSMethodSignature')
            throw new Error('fixture member shape changed');
        expect(property.optional).toBe(true);
        expect(method.optional).toBe(true);
        const instrument = result.ast.body[2];
        if (instrument.type !== 'ClassDeclaration') throw new Error('fixture class shape changed');
        const field = instrument.body.body[0];
        if (field.type !== 'PropertyDefinition') throw new Error('fixture field shape changed');
        expect(field.definite).toBe(true);
        expect(field.optional).toBe(false);
        expect(result.ast.comments?.map((comment) => comment.value.trim())).toContain('source comment');
        expect(result.ast.tokens?.find((token) => token.type === 'RegularExpression')?.value).toBe('/tone+/u');
        for (const token of result.ast.tokens ?? []) expect(code.slice(...token.range)).toBe(token.value);
    });

    it('retains native import/export and import-type attributes', () => {
        const result = parser.parseForESLint(
            'import data from "data.json" with { type: "json" }; export { default } from "other.json" with { type: "json" }; type Data = import("data.json", { with: { type: "json" } });',
            {
                filePath: filename,
                project: false,
                sourceType: 'module',
            }
        );
        const imported = result.ast.body[0];
        const exported = result.ast.body[1];
        const alias = result.ast.body[2];
        if (
            imported.type !== 'ImportDeclaration' ||
            exported.type !== 'ExportNamedDeclaration' ||
            alias.type !== 'TSTypeAliasDeclaration' ||
            alias.typeAnnotation.type !== 'TSImportType'
        )
            throw new Error('fixture attribute shape changed');
        expect(imported.attributes).toHaveLength(1);
        expect(exported.attributes).toHaveLength(1);
        expect(alias.typeAnnotation.options?.type).toBe('ObjectExpression');
    });

    it('resolves imported alias identity while keeping a shadowed local symbol distinct', () => {
        put('src/origin.ts', 'export const sourceTone = "oscillator" as const;');
        const result = parsed(
            'import { sourceTone as tone } from "#/origin"; function read(tone: number) { return tone; } export { tone, read };'
        );
        const services = result.services;
        if (!services.hasTypeInformation) throw new Error('Expected real native checker services');
        const imported = result.ast.body[0];
        const fn = result.ast.body[1];
        if (imported.type !== 'ImportDeclaration' || fn.type !== 'FunctionDeclaration')
            throw new Error('fixture AST shape changed');
        const alias = services.getSymbolAtLocation(imported.specifiers[0].local);
        expect(alias).toBeDefined();
        if (!alias) throw new Error('alias symbol missing');
        expect(services.checker.getAliasedSymbol(alias)?.name).toBe('sourceTone');
        const parameter = services.getSymbolAtLocation(fn.params[0]);
        expect(parameter).toBeDefined();
        expect(parameter).not.toBe(alias);
    });

    it('preserves the actual typeParameter naming rule and React numeric leak diagnostics', async () => {
        const bad = await messages(
            'type Box<T> = { value: T }; export function Panel(props: { count: number }) { return <div>{props.count && <span />}</div>; }'
        );
        expect(bad.filter((message) => message.ruleId === '@typescript-eslint/naming-convention')).toHaveLength(1);
        expect(
            bad.filter((message) => message.ruleId === '@eslint-react/no-leaked-conditional-rendering')
        ).toHaveLength(1);
        const good = await messages(
            'type Box<Value> = { value: Value }; export function Panel(props: { visible: boolean }) { return <div>{props.visible && <span />}</div>; }'
        );
        expect(good.filter((message) => message.ruleId === '@typescript-eslint/naming-convention')).toHaveLength(0);
        expect(
            good.filter((message) => message.ruleId === '@eslint-react/no-leaked-conditional-rendering')
        ).toHaveLength(0);
    });

    it('executes naming type filters through the native checker rather than treating every declaration alike', async () => {
        put('src/switch.ts', 'export type Switch = boolean;');
        const boolean = await messages(
            'import type { Switch } from "#/switch"; const enabled: Switch = true; export { enabled };',
            true
        );
        expect(boolean.filter((message) => message.ruleId === '@typescript-eslint/naming-convention')).toHaveLength(1);
        const string = await messages('const enabled: string = "yes"; export { enabled };', true);
        expect(string.filter((message) => message.ruleId === '@typescript-eslint/naming-convention')).toHaveLength(0);
    });

    it('retains hook admission and React import alias semantics', async () => {
        const invalid = await messages(
            'import { useState as useTone } from "react"; export function Panel(props: { enabled: boolean }) { if (props.enabled) { useTone(0); } return <div />; }'
        );
        expect(invalid.filter((message) => message.ruleId === 'react-hooks/rules-of-hooks').length).toBeGreaterThan(0);
        expect(invalid.filter((message) => message.ruleId === '@eslint-react/rules-of-hooks').length).toBeGreaterThan(
            0
        );
        const valid = await messages(
            'import { useState } from "react"; export function Panel() { const [value] = useState(0); return <div>{value}</div>; }'
        );
        expect(
            valid.filter(
                (message) =>
                    message.ruleId === 'react-hooks/rules-of-hooks' || message.ruleId === '@eslint-react/rules-of-hooks'
            )
        ).toHaveLength(0);
    });

    it('runs both retained typed Query checks through native signatures and awaited results', async () => {
        const wrapper = await messages(
            'type UseQueryResult = { data: number }; declare function wrapper(): UseQueryResult; const { data, ...rest } = wrapper(); export { data, rest };'
        );
        expect(wrapper.filter((message) => message.ruleId === '@tanstack/query/no-rest-destructuring')).toHaveLength(1);
        const plain = await messages(
            'type PlainResult = { data: number }; declare function wrapper(): PlainResult; const { data, ...rest } = wrapper(); export { data, rest };'
        );
        expect(plain.filter((message) => message.ruleId === '@tanstack/query/no-rest-destructuring')).toHaveLength(0);
        const empty = await messages('export const config = { queryFn: (): Promise<void> => Promise.resolve() };');
        expect(empty.filter((message) => message.ruleId === '@tanstack/query/no-void-query-fn')).toHaveLength(1);
        const value = await messages('export const config = { queryFn: (): Promise<number> => Promise.resolve(1) };');
        expect(value.filter((message) => message.ruleId === '@tanstack/query/no-void-query-fn')).toHaveLength(0);
    });

    it('preserves custom foreign-store aliases, shadowing and type-only import classification', async () => {
        put(
            'src/infra/store/createStore.ts',
            'export function createStore() { return { set(value: number) { return value; } }; }'
        );
        put(
            'src/modules/Owner/stores/index.ts',
            'import { createStore } from "#/infra/store/createStore"; export const ownerStore = createStore();'
        );
        const bad = await messages(
            'import { ownerStore as remote } from "#/modules/Owner/stores"; const alias = remote; alias.set(1);'
        );
        expect(bad.filter((message) => message.ruleId === 'sourdaw/no-foreign-store-write')).toHaveLength(1);
        const shadowed = await messages(
            'import { ownerStore as remote } from "#/modules/Owner/stores"; function local(remote: { set(value: number): void }) { remote.set(1); } export { remote, local };'
        );
        expect(shadowed.filter((message) => message.ruleId === 'sourdaw/no-foreign-store-write')).toHaveLength(0);
        const typeOnly = await messages(
            'import type { ownerStore } from "#/modules/Owner/stores"; export type StoreShape = typeof ownerStore;'
        );
        expect(typeOnly.filter((message) => message.ruleId === 'sourdaw/no-foreign-store-write')).toHaveLength(0);
    });

    it('keeps an outer typed lease alive through two nested syntax parses and every exit callback', async () => {
        const captures: ReturnType<typeof parsed>[] = [];
        const events: string[] = [];
        const capturingParser = {
            ...parser,
            parseForESLint(...args: Parameters<typeof parser.parseForESLint>) {
                const result = parser.parseForESLint(...args);
                captures.push(result);
                return result;
            },
        };
        function observe(phase: string) {
            const result = captures[0];
            const services = result.services;
            if (!services.hasTypeInformation) throw new Error('Expected outer typed services');
            const statement = result.ast.body[0];
            if (statement.type !== 'VariableDeclaration') throw new Error('fixture AST shape changed');
            const node = statement.declarations[0].id;
            const type = services.getTypeAtLocation(node);
            if (!type.isStringLiteralType()) throw new Error('Outer checker lost literal identity');
            expect(type.value).toBe('outer');
            events.push(phase);
        }
        const result = new Linter({ cwd: fixtureRoot }).verify(
            'const tone = "outer" as const; function read() { return tone; } read();',
            {
                files: ['**/*.tsx'],
                languageOptions: {
                    parser: capturingParser,
                    parserOptions: {
                        project,
                        tsconfigRootDir: fixtureRoot,
                        nativeCompilerPath: getPreparedNativeTypeScriptPath(),
                    },
                },
                plugins: {
                    lifecycle: nativeLintLifecycle,
                    observation: {
                        rules: {
                            outer: {
                                create() {
                                    return {
                                        Program() {
                                            observe('before');
                                            parser.parseForESLint(
                                                'import type { Shape } from "shape"; export type Alias = Shape;',
                                                { project: false }
                                            );
                                            parser.parseForESLint('export const nested = () => 1;', { project: false });
                                            parser.parseForESLint('export const distinct = 2;', {
                                                filePath: join(fixtureRoot, 'distinct.ts'),
                                                project: false,
                                            });
                                            observe('after-nested');
                                        },
                                        'Program:exit'() {
                                            observe('program-exit');
                                        },
                                        onCodePathEnd(_codePath, node) {
                                            if (node.type === 'Program') observe('code-path-end');
                                        },
                                    };
                                },
                            },
                        },
                    },
                },
                // Register release first to show subsequent exit listeners still own
                // a live snapshot; release completes only after traversal returns.
                rules: { 'lifecycle/release-snapshot': 'error', 'observation/outer': 'error' },
            },
            { filename }
        );
        expect(result).toEqual([]);
        expect(events).toEqual(expect.arrayContaining(['before', 'after-nested', 'program-exit', 'code-path-end']));
        const services = captures[0].services;
        if (!services.hasTypeInformation) throw new Error('Expected outer typed services');
        await services.whenDisposed;
        expect(() => observe('stale')).toThrow('released');
    });

    it('reloads imported types, root discovery and extended config while preserving an earlier active lease', () => {
        put('settings/base.json', JSON.stringify({ compilerOptions: { strict: true } }));
        writeFileSync(
            project,
            JSON.stringify({
                extends: './settings/base.json',
                compilerOptions: { target: 'ESNext', module: 'ESNext' },
                include: ['src'],
            })
        );
        const imported = put('src/current.ts', 'export type Current = "first";');
        mkdirSync(join(fixtureRoot, 'src/already-empty'), { recursive: true });
        const code = 'import type { Current } from "../../../../current"; const tone: Current = "first";';
        writeFileSync(filename, code);
        const first = parsed(code);
        if (!first.services.hasTypeInformation) throw new Error('Expected first native services');
        const firstDeclaration = first.ast.body[1];
        if (firstDeclaration.type !== 'VariableDeclaration') throw new Error('fixture AST shape changed');
        const firstNode = firstDeclaration.declarations[0].id;
        expect(first.services.checker.typeToString(first.services.getTypeAtLocation(firstNode))).toBe('"first"');
        writeFileSync(imported, 'export type Current = "second";');
        const discovered = put('src/already-empty/new.ts', 'export const discovered = 7;');
        const second = parsed(code);
        if (!second.services.hasTypeInformation) throw new Error('Expected refreshed native services');
        const secondDeclaration = second.ast.body[1];
        if (secondDeclaration.type !== 'VariableDeclaration') throw new Error('fixture AST shape changed');
        const secondNode = secondDeclaration.declarations[0].id;
        expect(second.services.checker.typeToString(second.services.getTypeAtLocation(secondNode))).toBe('"second"');
        expect(first.services.checker.typeToString(first.services.getTypeAtLocation(firstNode))).toBe('"first"');
        expect(second.services.project.program.getSourceFileNames()).toContain(discovered);
        put('settings/base.json', JSON.stringify({ compilerOptions: { strict: true, noImplicitAny: false } }));
        const third = parsed(code);
        if (!third.services.hasTypeInformation) throw new Error('Expected refreshed configuration services');
        expect(third.services.project.compilerOptions.noImplicitAny).toBe(false);
        third.services.dispose();
        second.services.dispose();
        expect(first.services.checker.typeToString(first.services.getTypeAtLocation(firstNode))).toBe('"first"');
        first.services.dispose();
        expect(() => first.services.getTypeAtLocation(firstNode)).toThrow('released');
    });

    it('surfaces a recursive grammar error through the named rule while retaining valid sibling export diagnostics', async () => {
        put(
            'src/infra/store/createStore.ts',
            'export function createStore() { return { set(value: number) { return value; } }; }'
        );
        put('src/modules/Owner/stores/index.ts', 'export const broken = ;');
        await expect(
            customStoreMessages('import { broken as remote } from "#/modules/Owner/stores"; remote.set(1);')
        ).rejects.toThrow('Expression expected');
        put(
            'src/modules/ValidOwner/stores/index.ts',
            'import { createStore } from "#/infra/store/createStore"; export const valid = createStore();'
        );
        const sibling = await customStoreMessages(
            'import { valid as remote } from "#/modules/ValidOwner/stores"; remote.set(1);'
        );
        expect(sibling.map((message) => message.ruleId)).toEqual(['sourdaw/no-foreign-store-write']);
    });

    it('propagates EACCES from an existing source directory rather than treating it as an absent optional module', async () => {
        const source = put('src/modules/BlockedOwner/stores/index.ts', 'export const blocked = {};');
        chmodSync(dirname(source), 0o000);
        try {
            await expect(
                customStoreMessages('import { blocked as remote } from "#/modules/BlockedOwner/stores"; remote.set(1);')
            ).rejects.toThrow('EACCES');
        } finally {
            chmodSync(dirname(source), 0o755);
        }
    });

    it('rejects missing projects and syntax errors instead of returning syntax-only services', () => {
        const nativeCompilerPath = getPreparedNativeTypeScriptPath();
        expect(() =>
            parser.parseForESLint('const broken = ;', { filePath: filename, project, nativeCompilerPath })
        ).toThrow();
        expect(() =>
            parser.parseForESLint('export {};', {
                filePath: filename,
                project: join(fixtureRoot, 'absent.json'),
                nativeCompilerPath,
            })
        ).toThrow('does not exist');
        const excluded = put('excluded.ts', 'export {};');
        expect(() => parser.parseForESLint('export {};', { filePath: excluded, project, nativeCompilerPath })).toThrow(
            'outside'
        );
    });
});
