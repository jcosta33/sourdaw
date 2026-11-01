// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { playwrightExtensionPattern, playwrightTestDir } from '../vitestCollectionPatterns';

/**
 * Every E2E file takes `test` and `expect` from tests/e2e/e2eTest.ts, so a
 * per-test fixture added there reaches every test. A file that reaches either
 * value from `@playwright/test` bypasses that module. Lint does not cover
 * tests/e2e in CI, so this spec reads the source and fails on any such access.
 */

const root = resolve(import.meta.dirname, '../..');
const RUNNER_MODULE = '@playwright/test';
const RUNNER_VALUES = new Set(['test', 'expect']);
const SHARED_FIXTURE = `${playwrightTestDir}/e2eTest.ts`;
// Static pages and scripts the browser loads as assets, never Playwright modules.
const STATIC_FIXTURES = `${playwrightTestDir}/fixtures/`;
const MIN_E2E_FILES = 300;

function isRunnerSpecifier(node: ts.Node | undefined): boolean {
    return node !== undefined && ts.isStringLiteral(node) && node.text === RUNNER_MODULE;
}

function namesRunnerValue(elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>): boolean {
    return elements.some(
        (element) => !element.isTypeOnly && RUNNER_VALUES.has((element.propertyName ?? element.name).text)
    );
}

/** Whether an import declaration binds a runtime `test` or `expect`, by name or through the whole module. */
function importBindsRunnerValue(declaration: ts.ImportDeclaration): boolean {
    const clause = declaration.importClause;
    if (clause === undefined || clause.isTypeOnly) {
        return false;
    }
    if (clause.name !== undefined) {
        return true;
    }
    const bindings = clause.namedBindings;
    if (bindings === undefined) {
        return false;
    }
    return ts.isNamespaceImport(bindings) || namesRunnerValue(bindings.elements);
}

/** Whether a re-export passes a runtime `test` or `expect` on, by name or through the whole module. */
function exportPassesRunnerValue(declaration: ts.ExportDeclaration): boolean {
    if (declaration.isTypeOnly) {
        return false;
    }
    const clause = declaration.exportClause;
    return clause === undefined || ts.isNamespaceExport(clause) || namesRunnerValue(clause.elements);
}

function isRunnerBypass(node: ts.Node): boolean {
    if (ts.isImportDeclaration(node)) {
        return isRunnerSpecifier(node.moduleSpecifier) && importBindsRunnerValue(node);
    }
    if (ts.isExportDeclaration(node)) {
        return isRunnerSpecifier(node.moduleSpecifier) && exportPassesRunnerValue(node);
    }
    if (ts.isImportEqualsDeclaration(node)) {
        const reference = node.moduleReference;
        return !node.isTypeOnly && ts.isExternalModuleReference(reference) && isRunnerSpecifier(reference.expression);
    }
    if (ts.isCallExpression(node)) {
        const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
        const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
        return (isRequire || isDynamicImport) && isRunnerSpecifier(node.arguments[0]);
    }
    return false;
}

/**
 * The statements and expressions that reach a runtime value of the runner
 * module: imports or re-exports of `test`, `expect`, or the whole module, and
 * any `require` or dynamic `import()` of it.
 */
function runnerBypasses(text: string, fileName: string): string[] {
    const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    const bypasses: string[] = [];
    const visit = (node: ts.Node): void => {
        if (isRunnerBypass(node)) {
            bypasses.push(node.getText(sourceFile));
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return bypasses;
}

/** Every module Playwright could load under the E2E directory, as repository paths. */
function listE2eSourceFiles(repositoryRoot: string): string[] {
    const entries = readdirSync(join(repositoryRoot, playwrightTestDir), { recursive: true, withFileTypes: true });
    const sourceEntries = entries.filter((entry) => entry.isFile() && playwrightExtensionPattern.test(entry.name));
    const paths = sourceEntries.map((entry) =>
        relative(repositoryRoot, join(entry.parentPath, entry.name)).split('\\').join('/')
    );
    return paths.filter((path) => path !== SHARED_FIXTURE && !path.startsWith(STATIC_FIXTURES)).sort();
}

const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

function repositoryWith(files: readonly string[]): string {
    const folder = mkdtempSync(join(tmpdir(), 'e2e-shared-fixture-'));
    folders.push(folder);
    for (const file of files) {
        mkdirSync(dirname(join(folder, file)), { recursive: true });
        writeFileSync(join(folder, file), '');
    }
    return folder;
}

describe('E2E files take test and expect from the shared fixture', () => {
    it.each([
        ['named test', "import { test } from '@playwright/test';"],
        ['named expect with a type import', "import { expect, type Page } from '@playwright/test';"],
        ['aliased test', "import { test as base } from '@playwright/test';"],
        ['namespace import', "import * as pw from '@playwright/test';"],
        ['default import', "import pw from '@playwright/test';"],
        ['multi-line named imports', "import {\n    expect,\n    test,\n} from '@playwright/test';"],
        ['named re-export', "export { test } from '@playwright/test';"],
        ['aliased re-export of expect', "export { expect as check } from '@playwright/test';"],
        ['star re-export', "export * from '@playwright/test';"],
        ['namespace re-export', "export * as pw from '@playwright/test';"],
        ['import-equals require', "import pw = require('@playwright/test');"],
        ['require call', "const { test } = require('@playwright/test');"],
        ['nested require call', "function load() {\n    return require('@playwright/test').test;\n}"],
        ['dynamic import', "const { expect } = await import('@playwright/test');"],
        ['nested dynamic import', "async function load() {\n    return (await import('@playwright/test')).test;\n}"],
    ])('flags %s', (_name, source) => {
        expect(runnerBypasses(source, 'spec.ts')).toHaveLength(1);
    });

    it.each([
        ['inline type import', "import { type Page } from '@playwright/test';"],
        ['type-only declaration', "import type { Page, Locator } from '@playwright/test';"],
        ['non-runner value', "import { chromium } from '@playwright/test';"],
        ['config helpers', "import { defineConfig, devices } from '@playwright/test';"],
        ['shared fixture', "import { test } from './e2eTest';"],
        ['type-only re-export', "export type { Page } from '@playwright/test';"],
        ['non-runner re-export', "export { devices } from '@playwright/test';"],
        ['shared fixture re-export', "export { test, expect } from './e2eTest';"],
        ['type-only import-equals', "import type pw = require('@playwright/test');"],
        ['import type query', "type Page = import('@playwright/test').Page;"],
        ['require of another module', "const fs = require('node:fs');"],
        ['dynamic import of another module', "const fixture = await import('./e2eTest');"],
    ])('allows %s', (_name, source) => {
        expect(runnerBypasses(source, 'spec.ts')).toEqual([]);
    });

    it('lists every module Playwright could load, however deep, except static fixtures and the shared fixture', () => {
        const repository = repositoryWith([
            'tests/e2e/top.spec.ts',
            'tests/e2e/e2eTest.ts',
            'tests/e2e/view.spec.tsx',
            'tests/e2e/nested/deep/flow.spec.mjs',
            'tests/e2e/nested/helper.cjs',
            'tests/e2e/nested/legacy.test.jsx',
            'tests/e2e/fixtures/app/App.js',
            'tests/e2e/probe.html',
            'tests/e2e/notes.md',
        ]);

        expect(listE2eSourceFiles(repository)).toEqual([
            'tests/e2e/nested/deep/flow.spec.mjs',
            'tests/e2e/nested/helper.cjs',
            'tests/e2e/nested/legacy.test.jsx',
            'tests/e2e/top.spec.ts',
            'tests/e2e/view.spec.tsx',
        ]);
    });

    it('no E2E file reaches test or expect from @playwright/test', () => {
        const files = listE2eSourceFiles(root);
        expect(files.length, 'the scan must cover the E2E directory').toBeGreaterThan(MIN_E2E_FILES);
        const offenders = files.filter(
            (path) => runnerBypasses(readFileSync(join(root, path), 'utf8'), path).length > 0
        );
        expect(
            offenders,
            `These E2E files reach test or expect from @playwright/test. Import them from ${SHARED_FIXTURE} instead:\n${offenders.join('\n')}`
        ).toEqual([]);
    });
});
