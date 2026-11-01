// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { playwrightTestDir } from '../vitestCollectionPatterns';

/**
 * Every E2E file takes `test` and `expect` from tests/e2e/e2eTest.ts, so a
 * per-test fixture added there reaches every test. A file that imports either
 * value from `@playwright/test` bypasses that module. Lint does not cover
 * tests/e2e in CI, so this spec reads the source and fails on any such import.
 */

const root = resolve(import.meta.dirname, '../..');
const RUNNER_MODULE = '@playwright/test';
const RUNNER_VALUES = new Set(['test', 'expect']);
const SHARED_FIXTURE = `${playwrightTestDir}/e2eTest.ts`;
const MIN_E2E_FILES = 300;

/** The import declarations that bind a runtime `test` or `expect` (or anything else at runtime) from the runner. */
function runtimeRunnerImports(text: string, fileName: string): string[] {
    const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return sourceFile.statements.flatMap((statement) => {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
            return [];
        }
        if (statement.moduleSpecifier.text !== RUNNER_MODULE) {
            return [];
        }
        return bindsRuntimeRunnerValue(statement) ? [statement.getText(sourceFile)] : [];
    });
}

function bindsRuntimeRunnerValue(declaration: ts.ImportDeclaration): boolean {
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
    if (ts.isNamespaceImport(bindings)) {
        return true;
    }
    return bindings.elements.some(
        (element) => !element.isTypeOnly && RUNNER_VALUES.has((element.propertyName ?? element.name).text)
    );
}

function listE2eSourceFiles(): string[] {
    const entries = readdirSync(join(root, playwrightTestDir), { recursive: true, withFileTypes: true });
    const sourceEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.ts'));
    const paths = sourceEntries.map((entry) =>
        relative(root, join(entry.parentPath, entry.name)).split('\\').join('/')
    );
    return paths.filter((path) => path !== SHARED_FIXTURE);
}

describe('E2E files take test and expect from the shared fixture', () => {
    it.each([
        ['named test', "import { test } from '@playwright/test';"],
        ['named expect with a type import', "import { expect, type Page } from '@playwright/test';"],
        ['aliased test', "import { test as base } from '@playwright/test';"],
        ['namespace import', "import * as pw from '@playwright/test';"],
        ['multi-line named imports', "import {\n    expect,\n    test,\n} from '@playwright/test';"],
    ])('flags %s', (_name, source) => {
        expect(runtimeRunnerImports(source, 'spec.ts')).toHaveLength(1);
    });

    it.each([
        ['inline type import', "import { type Page } from '@playwright/test';"],
        ['type-only declaration', "import type { Page, Locator } from '@playwright/test';"],
        ['non-runner value', "import { chromium } from '@playwright/test';"],
        ['config helpers', "import { defineConfig, devices } from '@playwright/test';"],
        ['shared fixture', "import { test } from './e2eTest';"],
    ])('allows %s', (_name, source) => {
        expect(runtimeRunnerImports(source, 'spec.ts')).toEqual([]);
    });

    it('no E2E file imports test or expect from @playwright/test', () => {
        const files = listE2eSourceFiles();
        expect(files.length, 'the scan must cover the E2E directory').toBeGreaterThan(MIN_E2E_FILES);
        const offenders = files.filter(
            (path) => runtimeRunnerImports(readFileSync(join(root, path), 'utf8'), path).length > 0
        );
        expect(
            offenders,
            `These E2E files import test or expect from @playwright/test. Import them from ${SHARED_FIXTURE} instead:\n${offenders.join('\n')}`
        ).toEqual([]);
    });
});
