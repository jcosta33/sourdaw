import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isSourdawE2eServeMode } from '../e2eServerIdentity.ts';

/**
 * Structural pins for the uncached-responses wiring. The behavioral spec
 * builds its own Vite server around the plugin, so it stays green when the
 * real e2e dev server stops installing it: the registration, the serve-only
 * e2e gate, and the launcher's mode argument ARE the protection. Same
 * compiler idiom as e2eServerIdentityWiring.spec.ts.
 */

const repositoryRoot = resolve(import.meta.dirname, '../..');

function parseSource(relativePath: string): ts.SourceFile {
    const absolutePath = join(repositoryRoot, relativePath);
    return ts.createSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'), ts.ScriptTarget.Latest);
}

// forEachChild, never getChildren: see e2eServerIdentityWiring.spec.ts.
function findNode<T extends ts.Node>(node: ts.Node, matches: (candidate: ts.Node) => candidate is T): T | undefined {
    if (matches(node)) {
        return node;
    }
    let found: T | undefined;
    node.forEachChild((child) => {
        found ??= findNode(child, matches);
    });
    return found;
}

function viteConfigPlugins(sourceFile: ts.SourceFile): ts.NodeArray<ts.Expression> {
    const exportDefault = sourceFile.statements.find((statement): statement is ts.ExportAssignment =>
        ts.isExportAssignment(statement)
    );
    const config =
        exportDefault && ts.isCallExpression(exportDefault.expression) ? exportDefault.expression : undefined;
    const [argument] = config?.arguments ?? [];
    if (!argument || !ts.isObjectLiteralExpression(argument)) {
        throw new Error('vite.config.ts must default-export defineConfig({...})');
    }
    const plugins = argument.properties.find(
        (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'plugins'
    );
    if (!plugins || !ts.isArrayLiteralExpression(plugins.initializer)) {
        throw new Error('vite.config.ts must list plugins as an array');
    }
    return plugins.initializer.elements;
}

function pluginApplyBody(sourceFile: ts.SourceFile, pluginName: string): ts.ConciseBody {
    const declaration = sourceFile.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(statement) && statement.name?.text === pluginName
    );
    const returned = declaration?.body?.statements.find((statement): statement is ts.ReturnStatement =>
        ts.isReturnStatement(statement)
    )?.expression;
    if (!returned || !ts.isObjectLiteralExpression(returned)) {
        throw new Error(`${pluginName}() must return a plugin object literal`);
    }
    const apply = returned.properties.find(
        (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'apply'
    );
    if (!apply || !ts.isArrowFunction(apply.initializer)) {
        throw new Error(`${pluginName}() must gate itself with an apply arrow function`);
    }
    return apply.initializer.body;
}

function isServeCommandCheck(node: ts.Expression): boolean {
    return (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isIdentifier(node.left) &&
        node.left.text === 'command' &&
        ts.isStringLiteral(node.right) &&
        node.right.text === 'serve'
    );
}

function isE2eModeCheck(node: ts.Expression): boolean {
    if (
        !ts.isCallExpression(node) ||
        !ts.isIdentifier(node.expression) ||
        node.expression.text !== 'isSourdawE2eServeMode' ||
        node.arguments.length !== 1
    ) {
        return false;
    }
    const [argument] = node.arguments;
    return argument !== undefined && ts.isIdentifier(argument) && argument.text === 'mode';
}

function launcherModeArgument(sourceFile: ts.SourceFile): string | undefined {
    const launch = findNode(
        sourceFile,
        (node): node is ts.CallExpression =>
            ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'runE2eDevServer'
    );
    const viteArguments = launch?.arguments[3];
    if (!viteArguments || !ts.isArrayLiteralExpression(viteArguments)) {
        throw new Error('scripts/e2eDevServer.ts must launch Vite through runE2eDevServer(root, port, command, [...])');
    }
    const elements = viteArguments.elements;
    const flag = elements.findIndex((element) => ts.isStringLiteral(element) && element.text === '--mode');
    const value = elements[flag + 1];
    return flag >= 0 && value !== undefined && ts.isStringLiteral(value) ? value.text : undefined;
}

describe('e2e uncached-responses wiring', () => {
    it('vite.config.ts registers sourdawE2eUncachedResponsesPlugin() in the plugins array', () => {
        const registered = viteConfigPlugins(parseSource('vite.config.ts')).some(
            (element) =>
                ts.isCallExpression(element) &&
                ts.isIdentifier(element.expression) &&
                element.expression.text === 'sourdawE2eUncachedResponsesPlugin'
        );

        expect(registered, 'without the registration the e2e dev server revalidates modules with 304s').toBe(true);
    });

    it("gates the plugin with command === 'serve' && isSourdawE2eServeMode(mode)", () => {
        const body = pluginApplyBody(
            parseSource('scripts/e2eUncachedResponses.ts'),
            'sourdawE2eUncachedResponsesPlugin'
        );

        if (!ts.isBinaryExpression(body) || body.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) {
            throw new Error('the apply predicate must be one && conjunction of the serve and e2e-mode terms');
        }
        expect(isServeCommandCheck(body.left), "the gate's left term must be command === 'serve'").toBe(true);
        expect(isE2eModeCheck(body.right), "the gate's right term must be isSourdawE2eServeMode(mode)").toBe(true);
    });

    it('launches the e2e dev server in the mode the plugin gate admits', () => {
        const mode = launcherModeArgument(parseSource('scripts/e2eDevServer.ts'));

        expect(mode, 'scripts/e2eDevServer.ts must pass --mode <mode> to Vite').toBeDefined();
        expect(isSourdawE2eServeMode(mode ?? '')).toBe(true);
    });
});
