import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Structural pins for the lane-isolation wiring itself
 * (scripts/e2eServerIdentity.ts). The behavioral specs prove the helpers and
 * the Playwright derivation, but every helper passing while the wiring is
 * deleted would still leave lanes sharing a dev server silently — the
 * registration, the mode gate, and the two assertion call sites ARE the
 * protection. Same compiler idiom as browserAiWebGpuAdmission.spec.ts: parse
 * the target file and assert the structure that must survive.
 */

const repositoryRoot = resolve(import.meta.dirname, '../..');

function parseSource(relativePath: string): ts.SourceFile {
    const absolutePath = join(repositoryRoot, relativePath);
    return ts.createSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'), ts.ScriptTarget.Latest);
}

function findFunctionDeclaration(sourceFile: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined {
    return sourceFile.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(statement) && statement.name?.text === name
    );
}

// Descend with forEachChild, never getChildren: under the installed
// TypeScript, getChildren re-scans the source text through the node's
// lazily-assigned source-file chain and throws on subtrees reached by
// property access before a full top-down walk; forEachChild visits parsed
// nodes only and needs no parent pointers.
function containsCallTo(node: ts.Node, calleeName: string): boolean {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === calleeName) {
        return true;
    }
    let found = false;
    node.forEachChild((child) => {
        if (!found) {
            found = containsCallTo(child, calleeName);
        }
    });
    return found;
}

function containsAwaitedCallTo(node: ts.Node, calleeName: string): boolean {
    if (
        ts.isAwaitExpression(node) &&
        ts.isCallExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === calleeName
    ) {
        return true;
    }
    let found = false;
    node.forEachChild((child) => {
        if (!found) {
            found = containsAwaitedCallTo(child, calleeName);
        }
    });
    return found;
}

function requirePluginRegisteredInViteConfig(sourceFile: ts.SourceFile): void {
    const exportDefault = sourceFile.statements.find((statement): statement is ts.ExportAssignment =>
        ts.isExportAssignment(statement)
    );
    if (
        !exportDefault ||
        !ts.isCallExpression(exportDefault.expression) ||
        !ts.isIdentifier(exportDefault.expression.expression) ||
        exportDefault.expression.expression.text !== 'defineConfig'
    ) {
        throw new Error('vite.config.ts must default-export defineConfig({...})');
    }
    const [argument] = exportDefault.expression.arguments;
    if (!argument || !ts.isObjectLiteralExpression(argument)) {
        throw new Error('defineConfig must receive an object literal');
    }
    const plugins = argument.properties.find(
        (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'plugins'
    );
    if (!plugins || !ts.isArrayLiteralExpression(plugins.initializer)) {
        throw new Error('vite.config.ts must list plugins as an array');
    }
    const registered = plugins.initializer.elements.some(
        (element) =>
            ts.isCallExpression(element) &&
            ts.isIdentifier(element.expression) &&
            element.expression.text === 'sourdawE2eServingCheckoutPlugin'
    );
    if (!registered) {
        throw new Error(
            'vite.config.ts must register sourdawE2eServingCheckoutPlugin() in plugins; without it no e2e server stamps the serving-checkout marker'
        );
    }
}

function requireApplyKeepsModeGate(sourceFile: ts.SourceFile): void {
    const declaration = findFunctionDeclaration(sourceFile, 'sourdawE2eServingCheckoutPlugin');
    if (!declaration) {
        throw new Error('vite.config.ts must declare function sourdawE2eServingCheckoutPlugin()');
    }
    const body = declaration.body;
    const returnStatement = body?.statements.find((statement): statement is ts.ReturnStatement =>
        ts.isReturnStatement(statement)
    );
    if (!returnStatement?.expression || !ts.isObjectLiteralExpression(returnStatement.expression)) {
        throw new Error('sourdawE2eServingCheckoutPlugin() must return an object literal');
    }
    const apply = returnStatement.expression.properties.find(
        (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'apply'
    );
    if (!apply || !ts.isArrowFunction(apply.initializer)) {
        throw new Error('the identity plugin must gate itself with an apply arrow function');
    }
    if (!containsCallTo(apply.initializer.body, 'isSourdawE2eServeMode')) {
        throw new Error(
            "the plugin's apply predicate must keep the isSourdawE2eServeMode(mode) term; without it the marker leaks beyond e2e serve mode"
        );
    }
}

function requireWarmupAssertsIdentity(sourceFile: ts.SourceFile): void {
    const warmup = findFunctionDeclaration(sourceFile, 'warmFirstPaint');
    if (!warmup) {
        throw new Error('tests/e2e/firstPaintWarmup.ts must declare warmFirstPaint() as its global setup');
    }
    if (!containsAwaitedCallTo(warmup, 'assertServingCheckoutIdentity')) {
        throw new Error(
            'warmFirstPaint() must await assertServingCheckoutIdentity before navigating; without it a reused server from another checkout is silently verified'
        );
    }
}

describe('e2e serving-identity wiring', () => {
    it('vite.config.ts registers sourdawE2eServingCheckoutPlugin() in the plugins array', () => {
        expect(() => requirePluginRegisteredInViteConfig(parseSource('vite.config.ts'))).not.toThrow();
    });

    it("keeps the isSourdawE2eServeMode(mode) term in the plugin's apply predicate", () => {
        expect(() => requireApplyKeepsModeGate(parseSource('vite.config.ts'))).not.toThrow();
    });

    it('firstPaintWarmup awaits assertServingCheckoutIdentity inside warmFirstPaint', () => {
        expect(() => requireWarmupAssertsIdentity(parseSource('tests/e2e/firstPaintWarmup.ts'))).not.toThrow();
    });

    it('agent ui-scripts await assertServingCheckoutIdentity before navigating (source pin: no TS project covers .agents)', () => {
        const utilsPath = join(repositoryRoot, '.agents/ui-scripts/utils.ts');
        expect(readFileSync(utilsPath, 'utf8')).toMatch(/await\s+assertServingCheckoutIdentity\(/);
    });
});
