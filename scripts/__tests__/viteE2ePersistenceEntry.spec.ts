// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import ts from 'typescript';
import { resolveConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

function hasDynamicImport(node: ts.Node): boolean {
    return (
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
        ts.forEachChild(node, hasDynamicImport) === true
    );
}

function runtimeExpression(expression: ts.Expression): ts.Expression {
    while (
        ts.isParenthesizedExpression(expression) ||
        ts.isSatisfiesExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isTypeAssertionExpression(expression) ||
        ts.isNonNullExpression(expression) ||
        ts.isExpressionWithTypeArguments(expression)
    ) {
        expression = expression.expression;
    }
    return expression;
}

function isSafeDirectProjectEntry(entry: string): boolean {
    if (/createProject|projectStore\.set/.test(entry)) {
        return false;
    }
    const source = ts.createSourceFile('entry.ts', entry, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (hasDynamicImport(source)) {
        return false;
    }
    const bindings = source.statements.flatMap((statement) => {
        if (
            !ts.isImportDeclaration(statement) ||
            !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== '../../src/modules/Project/useCases' ||
            !statement.importClause ||
            statement.importClause.isTypeOnly ||
            !statement.importClause.namedBindings ||
            !ts.isNamedImports(statement.importClause.namedBindings)
        ) {
            return [];
        }
        return statement.importClause.namedBindings.elements
            .filter((element) => !element.isTypeOnly && (element.propertyName ?? element.name).text === 'newProject')
            .map((element) => element.name.text);
    });
    if (bindings.length !== 1) {
        return false;
    }
    const runtimeBindings = new Set<string>();
    for (const statement of source.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) {
            runtimeBindings.add(statement.name.text);
        }
        if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly) {
            const clause = statement.importClause;
            if (clause.name) {
                runtimeBindings.add(clause.name.text);
            }
            if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
                runtimeBindings.add(clause.namedBindings.name.text);
            } else if (clause.namedBindings) {
                for (const element of clause.namedBindings.elements) {
                    if (!element.isTypeOnly) {
                        runtimeBindings.add(element.name.text);
                    }
                }
            }
        }
    }
    let aliasFound = false;
    for (const statement of source.statements) {
        if (
            ts.isImportDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isFunctionDeclaration(statement)
        ) {
            continue;
        }
        if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) {
            return false;
        }
        const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
                return false;
            }
            const initializer = runtimeExpression(declaration.initializer);
            if (declaration.name.text === 'newProject') {
                if (!exported || !ts.isIdentifier(initializer) || initializer.text !== bindings[0]) {
                    return false;
                }
                aliasFound = true;
            } else if (
                !(ts.isIdentifier(initializer) && runtimeBindings.has(initializer.text)) &&
                !ts.isArrowFunction(initializer) &&
                !ts.isFunctionExpression(initializer)
            ) {
                return false;
            }
            runtimeBindings.add(declaration.name.text);
        }
    }
    return aliasFound;
}

describe('same-build persistence inspection entry', () => {
    it('accepts a lazy read-only constructor without running it at module load', () => {
        const entry = `
            import { newProject as _newProject } from '../../src/modules/Project/useCases';
            export const newProject = _newProject;
            export const inspectProject = () => new Set();
        `;
        expect(isSafeDirectProjectEntry(entry)).toBe(true);
    });

    it('accepts an equivalent named import alias', () => {
        const entry = `import { newProject as makeProject } from '../../src/modules/Project/useCases';
            export const newProject = makeProject;`;
        expect(isSafeDirectProjectEntry(entry)).toBe(true);
    });

    it.each([
        ['satisfies', '_newProject satisfies typeof _newProject'],
        ['nested assertions', '((<_T>(_newProject as _T))!)'],
    ])('accepts an erased %s alias wrapper', (_name, initializer) => {
        const entry = `import { newProject as _newProject } from '../../src/modules/Project/useCases';
            type _T = typeof _newProject;
            export const newProject = ${initializer};`;
        expect(isSafeDirectProjectEntry(entry)).toBe(true);
        expect(ts.transpileModule(entry, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toMatch(
            /export const newProject = \(*_newProject\)*/
        );
    });

    it('accepts an erased wrapper around a lazy function', () => {
        const entry = `import { newProject as _newProject } from '../../src/modules/Project/useCases';
            export const newProject = _newProject;
            const inspect = (((() => new Set()) satisfies () => Set<unknown>)!);`;
        expect(isSafeDirectProjectEntry(entry)).toBe(true);
        expect(ts.transpileModule(entry, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toContain(
            '() => new Set()'
        );
    });

    it('accepts runtime bindings and erased generic instantiation without invoking them', () => {
        const entry = `import { newProject as _newProject } from '../../src/modules/Project/useCases';
            import { inspect as imported } from './inspection';
            function identity<T>(value: T) { return value; }
            const inspect = identity<string>;
            const next = inspect;
            const external = imported;
            export const newProject = _newProject;`;
        expect(isSafeDirectProjectEntry(entry)).toBe(true);
        expect(ts.transpileModule(entry, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toMatch(
            /const inspect = \(*identity\)*/
        );
    });

    it('rejects an ambient getter read during module initialization', () => {
        const base = `import { newProject as _newProject } from '../../src/modules/Project/useCases';
            export const newProject = _newProject;`;
        const observeReads = (entry: string) => {
            let reads = 0;
            const sandbox = { exports: {}, require: () => ({ newProject: () => true }) };
            Object.defineProperty(sandbox, 'localStorage', { get: () => ++reads });
            const emitted = ts.transpileModule(entry, {
                compilerOptions: { module: ts.ModuleKind.CommonJS },
            }).outputText;
            runInNewContext(emitted, sandbox);
            return reads;
        };
        expect(observeReads(base)).toBe(0);
        const entry = `${base}\nconst inspect = localStorage;`;
        expect(observeReads(entry)).toBe(1);
        expect(isSafeDirectProjectEntry(entry)).toBe(false);
    });

    it.each([
        ['top-level call', 'newProject();'],
        ['constructor with arguments', 'const value = new Set([1]);'],
        ['constructor without arguments', 'const value = new Set();'],
        ['wrapped call', 'const value = (newProject() as unknown)!;'],
        ['wrapped constructor', 'const value = (new Set() satisfies Set<unknown>);'],
        ['generic call', 'const value = identity<string>("x");'],
        ['dynamic import', "const lazy = () => import('other');"],
        ['dynamic import with comment', "const lazy = () => import /* comment */ ('other');"],
        ['createProject', 'const lazy = () => createProject();'],
        ['projectStore.set', 'const lazy = () => projectStore.set({});'],
    ])('rejects %s in an otherwise valid entry', (_name, addition) => {
        const entry = `import { newProject as _newProject } from '../../src/modules/Project/useCases';
            export const newProject = _newProject;\n${addition}`;
        expect(isSafeDirectProjectEntry(entry)).toBe(false);
    });

    it.each([
        ['wrapped alias', 'export const newProject = () => _newProject();'],
        ['wrong alias', 'export const newProject = other;'],
        ['wrapped wrong alias', 'export const newProject = (other as typeof _newProject)!;'],
    ])('rejects %s', (_name, declaration) => {
        const entry = `import { newProject as _newProject } from '../../src/modules/Project/useCases';\n${declaration}`;
        expect(isSafeDirectProjectEntry(entry)).toBe(false);
    });

    it.each([
        ['wrong import target', "import { newProject as _newProject } from './other';"],
        ['type-only binding', "import type { newProject as _newProject } from '../../src/modules/Project/useCases';"],
    ])('rejects %s', (_name, declaration) => {
        const entry = `${declaration}\nexport const newProject = _newProject;`;
        expect(isSafeDirectProjectEntry(entry)).toBe(false);
    });

    it('keeps the real index entry and eight direct namespaces only in e2e builds', async () => {
        const e2e = await resolveConfig({ root, mode: 'e2e' }, 'build');
        expect(e2e.build.rolldownOptions.input).toEqual({
            index: resolve(root, 'index.html'),
            'persisted-hydration': resolve(root, 'tests/e2e/persistedHydrationEntry.ts'),
            'direct-project-setup': resolve(root, 'tests/e2e/directProjectSetupEntry.ts'),
        });
        expect(e2e.build.rolldownOptions.preserveEntrySignatures).toBe('strict');
        const output = e2e.build.rolldownOptions.output;
        if (Array.isArray(output) || typeof output?.entryFileNames !== 'function') {
            throw new TypeError('The persistence entry requires its own deterministic filename');
        }
        const entry = readFileSync(resolve(root, 'tests/e2e/persistedHydrationEntry.ts'), 'utf8');
        expect(
            Array.from(entry.matchAll(/export \* as (\w+) from '([^']+)'/g), ([, name, path]) => [name, path])
        ).toEqual([
            ['arrangement', '../../src/modules/Arrangement/stores'],
            ['midi', '../../src/modules/MIDI/stores'],
            ['automation', '../../src/modules/Automation/stores'],
            ['project', '../../src/modules/Project/stores'],
            ['crdt', '../../src/modules/CrdtDocument/useCases'],
            ['inspection', '../../src/modules/CrdtDocument/useCases/agentProjectInspectionPort'],
            ['audio', '../../src/modules/AudioEngine/useCases'],
            ['command', '../../src/modules/Command/useCases'],
        ]);
    });

    it('emits the direct project setup entry at a deterministic e2e path', async () => {
        const e2e = await resolveConfig({ root, mode: 'e2e' }, 'build');
        const output = e2e.build.rolldownOptions.output;
        if (Array.isArray(output) || typeof output?.entryFileNames !== 'function') {
            throw new TypeError('The persistence entry requires its own deterministic filename');
        }
        expect(
            output.entryFileNames({
                name: 'direct-project-setup',
                isEntry: true,
                isDynamicEntry: false,
                facadeModuleId: null,
                moduleIds: [],
                exports: [],
            })
        ).toBe('e2e/direct-project-setup.js');
        const entry = readFileSync(resolve(root, 'tests/e2e/directProjectSetupEntry.ts'), 'utf8');
        expect(isSafeDirectProjectEntry(entry)).toBe(true);
    });

    it('does not add the inspection entry or change entry signatures in a shipping build', async () => {
        const shipping = await resolveConfig({ root, mode: 'production' }, 'build');
        expect(shipping.build.rolldownOptions.input).toBeUndefined();
        expect(shipping.build.rolldownOptions.preserveEntrySignatures).toBeUndefined();
        expect(shipping.plugins.some((plugin) => plugin.name === 'sourdaw-e2e-persistence-entry')).toBe(false);
    });

    it('retains preview checkout identity and cross-origin isolation for e2e mode', async () => {
        const preview = await resolveConfig({ root, mode: 'e2e' }, 'serve');
        const identity = preview.plugins.find((plugin) => plugin.name === 'sourdaw-e2e-serving-checkout');
        expect(identity?.configurePreviewServer).toBeTypeOf('function');
        expect(preview.preview.headers).toMatchObject({
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        });
        const shipping = await resolveConfig({ root, mode: 'production' }, 'serve');
        expect(shipping.plugins.some((plugin) => plugin.name === 'sourdaw-e2e-serving-checkout')).toBe(false);
    });

    it('serves the direct project setup entry at the deterministic path in e2e dev mode', async () => {
        const dev = await resolveConfig({ root, mode: 'e2e' }, 'serve');
        const plugin = dev.plugins.find((p) => p.name === 'sourdaw-e2e-persistence-entry');
        expect(plugin?.configureServer).toBeTypeOf('function');
    });
});
