import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const admissionSpecPath = join(repositoryRoot, 'tests/e2e/browserAiWebGpuAdmission.spec.ts');
const admissionTestName = 'proves the live Chromium Browser AI admission boundary without skipping';

function getAdmissionTestBody(sourceFile: ts.SourceFile): ts.Block {
    const admissionTest = sourceFile.statements.find((statement): statement is ts.ExpressionStatement => {
        if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
            return false;
        }

        const [name] = statement.expression.arguments;
        return (
            ts.isIdentifier(statement.expression.expression) &&
            statement.expression.expression.text === 'test' &&
            name !== undefined &&
            ts.isStringLiteral(name) &&
            name.text === admissionTestName
        );
    });

    if (!admissionTest || !ts.isCallExpression(admissionTest.expression)) {
        throw new Error(`missing Playwright test: ${admissionTestName}`);
    }

    const callback = admissionTest.expression.arguments[1];
    if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) {
        throw new Error(`Playwright test ${admissionTestName} must have a callback`);
    }
    if (!ts.isBlock(callback.body)) {
        throw new Error(`Playwright test ${admissionTestName} callback must have a block body`);
    }

    return callback.body;
}

function isColdStartTimeout(statement: ts.Statement): boolean {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) {
        return false;
    }

    const { expression, arguments: arguments_ } = statement.expression;
    const [timeout] = arguments_;
    return (
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'test' &&
        expression.name.text === 'setTimeout' &&
        timeout !== undefined &&
        ts.isNumericLiteral(timeout) &&
        Number(timeout.text) === 180_000
    );
}

function requireColdStartTimeoutFirst(callbackBody: ts.Block): void {
    const [firstStatement] = callbackBody.statements;
    if (!firstStatement || !isColdStartTimeout(firstStatement)) {
        throw new Error(`Playwright test ${admissionTestName} must begin with test.setTimeout(180_000)`);
    }
}

describe('Browser AI WebGPU admission', () => {
    it('reserves the cold-start budget needed before the launch-screen readiness gate', () => {
        const sourceFile = ts.createSourceFile(
            admissionSpecPath,
            readFileSync(admissionSpecPath, 'utf8'),
            ts.ScriptTarget.Latest
        );

        expect(() => requireColdStartTimeoutFirst(getAdmissionTestBody(sourceFile))).not.toThrow();
    });
});
