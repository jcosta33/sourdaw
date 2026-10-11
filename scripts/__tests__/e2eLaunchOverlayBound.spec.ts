import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isPlaywrightCollected } from '../vitestCollectionPatterns';

/**
 * `tests/e2e/e2eUtils.ts` declares that every spec waiting for the launch
 * overlay to appear owes `LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS`. Playwright
 * owns `tests/e2e/`, so Vitest collects this census from `scripts/__tests__/`
 * and reads exactly the files Playwright collects through the TypeScript
 * parser. A wait is judged by the locator it waits on, resolved through `const`
 * aliases in their own scope, so comments, strings, sibling tests, and child
 * locators of the overlay never count as overlay waits.
 */
const repositoryRoot = resolve(import.meta.dirname, '../..');
const e2eDirectory = join(repositoryRoot, 'tests/e2e');
const E2E_PATH_PREFIX = 'tests/e2e';
const BOUND_NAME = 'LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS';
const OVERLAY_LABEL = 'Sourdaw — start a project';
const OVERLAY_LABEL_CONSTANT = 'LAUNCH_SCREEN_NAME';
const ALIAS_DEPTH_LIMIT = 8;
const DISAPPEARANCE_STATES = new Set(['hidden', 'detached']);

type OverlayWait = { line: number; timeout: string | undefined };
type FirstPaintArgument = { line: number; milliseconds: number };
type SourceAnalysis = { waits: OverlayWait[]; firstPaintArguments: FirstPaintArgument[] };
type WaitOptions = { options: ts.Expression | undefined };

function createCheckedSource(text: string, fileName: string): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
    const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [], target: ts.ScriptTarget.Latest };
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, ...rest) => {
        if (name === fileName) {
            return ts.createSourceFile(name, text, languageVersion, true);
        }
        return read(name, languageVersion, ...rest);
    };
    const program = ts.createProgram([fileName], options, host);
    const sourceFile = program.getSourceFile(fileName);
    if (sourceFile === undefined) {
        throw new Error(`${fileName} did not parse`);
    }
    return { sourceFile, checker: program.getTypeChecker() };
}

function unwrap(expression: ts.Expression): ts.Expression {
    if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAwaitExpression(expression) ||
        ts.isNonNullExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isSatisfiesExpression(expression)
    ) {
        return unwrap(expression.expression);
    }
    return expression;
}

function isOverlayLabel(expression: ts.Expression | undefined): boolean {
    if (expression === undefined) {
        return false;
    }
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        return expression.text === OVERLAY_LABEL;
    }
    return ts.isIdentifier(expression) && expression.text === OVERLAY_LABEL_CONSTANT;
}

function propertyInitializer(options: ts.Expression | undefined, name: string): ts.Expression | undefined {
    if (options === undefined || !ts.isObjectLiteralExpression(options)) {
        return undefined;
    }
    for (const property of options.properties) {
        if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) {
            return property.initializer;
        }
        if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
            return property.name;
        }
    }
    return undefined;
}

function constInitializerOf(identifier: ts.Identifier, checker: ts.TypeChecker): ts.Expression | undefined {
    const declaration = checker.getSymbolAtLocation(identifier)?.declarations?.[0];
    if (
        declaration === undefined ||
        !ts.isVariableDeclaration(declaration) ||
        (declaration.parent.flags & ts.NodeFlags.Const) === 0
    ) {
        return undefined;
    }
    return declaration.initializer;
}

/**
 * The overlay locator is `getByLabel(<label>)` or `getByRole(<role>, { name:
 * <label> })` on any receiver, or a `const` bound to one in its own scope. A
 * locator chained after the overlay (`.locator(...)`, `.getByRole(...)`) is a
 * child, not the overlay.
 */
function isOverlayLocator(expression: ts.Expression, checker: ts.TypeChecker, depth = 0): boolean {
    const subject = unwrap(expression);
    if (ts.isIdentifier(subject)) {
        const initializer = constInitializerOf(subject, checker);
        return (
            depth < ALIAS_DEPTH_LIMIT && initializer !== undefined && isOverlayLocator(initializer, checker, depth + 1)
        );
    }
    if (!ts.isCallExpression(subject) || !ts.isPropertyAccessExpression(subject.expression)) {
        return false;
    }
    const method = subject.expression.name.text;
    if (method === 'getByLabel') {
        return isOverlayLabel(subject.arguments[0]);
    }
    if (method === 'getByRole') {
        return isOverlayLabel(propertyInitializer(subject.arguments[1], 'name'));
    }
    return false;
}

function isExpectCall(expression: ts.Expression): expression is ts.CallExpression {
    return (
        ts.isCallExpression(expression) &&
        ts.isIdentifier(expression.expression) &&
        expression.expression.text === 'expect'
    );
}

function containsNode(node: ts.Node, predicate: (candidate: ts.Node) => boolean): boolean {
    return predicate(node) || ts.forEachChild(node, (child) => containsNode(child, predicate) || undefined) === true;
}

function pollsOverlayVisibility(callback: ts.Expression | undefined, checker: ts.TypeChecker): boolean {
    if (callback === undefined || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        return false;
    }
    return containsNode(
        callback.body,
        (node) =>
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'isVisible' &&
            isOverlayLocator(node.expression.expression, checker)
    );
}

function waitsForDisappearance(options: ts.Expression | undefined): boolean {
    const state = propertyInitializer(options, 'state');
    return state !== undefined && ts.isStringLiteralLike(state) && DISAPPEARANCE_STATES.has(state.text);
}

/**
 * The three first-paint forms: `expect(<overlay>).toBeVisible(opts)`,
 * `<overlay>.waitFor(opts)` for the visible state, and `expect.poll(() =>
 * <overlay>.isVisible(), opts)`. Disappearance matchers and states are not
 * waits for the overlay to appear, and are not judged.
 */
function describeFirstPaintWait(call: ts.CallExpression, checker: ts.TypeChecker): WaitOptions | undefined {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee)) {
        return undefined;
    }
    const method = callee.name.text;
    if (method === 'toBeVisible') {
        const subject = callee.expression;
        const target = isExpectCall(subject) ? subject.arguments[0] : undefined;
        return target !== undefined && isOverlayLocator(target, checker) ? { options: call.arguments[0] } : undefined;
    }
    if (method === 'waitFor') {
        const appears = !waitsForDisappearance(call.arguments[0]);
        return appears && isOverlayLocator(callee.expression, checker) ? { options: call.arguments[0] } : undefined;
    }
    if (method === 'poll') {
        const isExpectPoll = ts.isIdentifier(callee.expression) && callee.expression.text === 'expect';
        if (!isExpectPoll || !pollsOverlayVisibility(call.arguments[0], checker)) {
            return undefined;
        }
        return { options: call.arguments[1] };
    }
    return undefined;
}

function firstPaintArgumentOf(node: ts.Node): number | undefined {
    if (
        !ts.isPropertyAssignment(node) ||
        !ts.isIdentifier(node.name) ||
        node.name.text !== 'firstPaintTimeoutMs' ||
        !ts.isNumericLiteral(node.initializer)
    ) {
        return undefined;
    }
    return Number(node.initializer.text.replaceAll('_', ''));
}

function analyzeSource(text: string, fileName: string): SourceAnalysis {
    const { sourceFile, checker } = createCheckedSource(text, fileName);
    const lineOf = (node: ts.Node): number =>
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const waits: OverlayWait[] = [];
    const firstPaintArguments: FirstPaintArgument[] = [];

    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const wait = describeFirstPaintWait(node, checker);
            if (wait !== undefined) {
                waits.push({
                    line: lineOf(node),
                    timeout: propertyInitializer(wait.options, 'timeout')?.getText(sourceFile),
                });
            }
        }
        const milliseconds = firstPaintArgumentOf(node);
        if (milliseconds !== undefined) {
            firstPaintArguments.push({ line: lineOf(node), milliseconds });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    return { waits, firstPaintArguments };
}

/** An explicit timeout on a judged wait must be the shared bound; no timeout rides the suite ceiling. */
function waitsOffTheBound(waits: OverlayWait[]): OverlayWait[] {
    return waits.filter((wait) => wait.timeout !== undefined && wait.timeout !== BOUND_NAME);
}

/** The repository-relative paths Playwright collects out of a list of paths. */
function selectPlaywrightCollected(paths: string[]): string[] {
    return paths.filter((path) => isPlaywrightCollected(path));
}

function listE2ePaths(): string[] {
    return readdirSync(e2eDirectory, { recursive: true, encoding: 'utf8' }).map(
        (path) => `${E2E_PATH_PREFIX}/${path.replaceAll('\\', '/')}`
    );
}

function readBoundMilliseconds(): number {
    const declaration = new RegExp(`export const ${BOUND_NAME} = ([\\d_]+);`).exec(
        readFileSync(join(e2eDirectory, 'e2eUtils.ts'), 'utf8')
    );
    expect(declaration, `${BOUND_NAME} declaration in e2eUtils.ts`).not.toBeNull();
    return Number((declaration?.[1] ?? '').replaceAll('_', ''));
}

function scanSpecs() {
    return selectPlaywrightCollected(listE2ePaths()).map((file) => ({
        file,
        ...analyzeSource(readFileSync(join(repositoryRoot, file), 'utf8'), file),
    }));
}

function analyzeSynthetic(...lines: string[]): SourceAnalysis {
    return analyzeSource(lines.join('\n'), 'synthetic.spec.ts');
}

describe('launch overlay first-paint bound', () => {
    const scanned = scanSpecs();

    it('finds the overlay waits and launch arguments the census exists to hold', () => {
        const filesWithWaits = scanned.filter((entry) => entry.waits.length > 0).map((entry) => entry.file);
        const filesWithBoundedWaits = scanned
            .filter((entry) => entry.waits.some((wait) => wait.timeout === BOUND_NAME))
            .map((entry) => entry.file);
        const filesWithLaunchArguments = scanned
            .filter((entry) => entry.firstPaintArguments.length > 0)
            .map((entry) => entry.file);

        // smoke.spec.ts delegates every overlay wait to
        // e2eUtils' wait_for_launch_first_paint (#4781), so its waits are held
        // by the helper's own bound rather than by a direct census hit.
        expect(filesWithWaits).toEqual(
            expect.arrayContaining([
                'tests/e2e/launchFlows.spec.ts',
                'tests/e2e/promptBarCancelRecentTestId.spec.ts',
                'tests/e2e/statusBarResponsive.spec.ts',
            ])
        );
        expect(filesWithBoundedWaits).toEqual(
            expect.arrayContaining([
                'tests/e2e/exportAudioEvidence.spec.ts',
                'tests/e2e/promptBarCancelRecentTestId.spec.ts',
                'tests/e2e/statusBarResponsive.spec.ts',
            ])
        );
        expect(filesWithLaunchArguments).toEqual(
            expect.arrayContaining(['tests/e2e/browserAiAdmittedPresentation.spec.ts', 'tests/e2e/smoke.spec.ts'])
        );
    });

    it('gives every explicit overlay wait the shared first-paint bound', () => {
        const offenders = scanned.flatMap((entry) =>
            waitsOffTheBound(entry.waits).map((wait) => `${entry.file}:${wait.line} timeout: ${wait.timeout}`)
        );

        expect(offenders).toEqual([]);
    });

    it('never passes launch_new_project a first-paint bound below the shared one', () => {
        const bound = readBoundMilliseconds();
        const offenders = scanned.flatMap((entry) =>
            entry.firstPaintArguments
                .filter((argument) => argument.milliseconds < bound)
                .map((argument) => `${entry.file}:${argument.line} firstPaintTimeoutMs: ${argument.milliseconds}`)
        );

        expect(offenders).toEqual([]);
    });

    describe('file selection', () => {
        it('scans exactly the paths Playwright collects, including .test.ts files', () => {
            expect(
                selectPlaywrightCollected([
                    'tests/e2e/smoke.spec.ts',
                    'tests/e2e/legacyFlow.test.ts',
                    'tests/e2e/nested/deepFlow.spec.ts',
                    'tests/e2e/e2eUtils.ts',
                    'tests/e2e/firstPaintWarmup.ts',
                    'tests/e2e/__tests__/helper.spec.ts',
                    'tests/e2e/nested',
                ])
            ).toEqual(['tests/e2e/smoke.spec.ts', 'tests/e2e/legacyFlow.test.ts', 'tests/e2e/nested/deepFlow.spec.ts']);
        });

        it('lists every collected spec in the e2e directory', () => {
            const collected = scanned.map((entry) => entry.file);

            expect(collected).toContain('tests/e2e/smoke.spec.ts');
            expect(collected).not.toContain('tests/e2e/e2eUtils.ts');
        });
    });

    describe('wait detection', () => {
        it('flags a short timeout on a label passed as LAUNCH_SCREEN_NAME', () => {
            const { waits } = analyzeSynthetic(
                'await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({',
                '    timeout: 5_000,',
                '});'
            );

            expect(waitsOffTheBound(waits)).toEqual([{ line: 1, timeout: '5_000' }]);
        });

        it('flags a short timeout on a label written as a template literal', () => {
            const { waits } = analyzeSynthetic(
                'await page.getByLabel(`Sourdaw — start a project`).waitFor({ timeout: 5_000 });',
                "await expect(page.getByRole('dialog', { name: `Sourdaw — start a project` })).toBeVisible({ timeout: 5_000 });"
            );

            expect(waitsOffTheBound(waits).map((wait) => wait.timeout)).toEqual(['5_000', '5_000']);
        });

        it('flags a short timeout on an expect.poll over isVisible', () => {
            const { waits } = analyzeSynthetic(
                "const overlay = page.getByLabel('Sourdaw — start a project');",
                'await expect.poll(async () => (await overlay.isVisible()), { timeout: 5_000 }).toBe(true);'
            );

            expect(waitsOffTheBound(waits)).toEqual([{ line: 2, timeout: '5_000' }]);
        });

        it('flags a short timeout reached through a frame locator', () => {
            const { waits } = analyzeSynthetic(
                "const frame = page.frameLocator('iframe');",
                'await expect(frame.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: 5_000 });'
            );

            expect(waitsOffTheBound(waits)).toEqual([{ line: 2, timeout: '5_000' }]);
        });

        it('flags a short timeout through an alias declared in the same test', () => {
            const { waits } = analyzeSynthetic(
                "test('opens', async ({ page }) => {",
                '    const overlay = page.getByLabel(LAUNCH_SCREEN_NAME);',
                '    await expect(overlay).toBeVisible({ timeout: 5_000 });',
                '    await overlay.waitFor({ state: "visible", timeout: 5_000 });',
                '});'
            );

            expect(waitsOffTheBound(waits).map((wait) => wait.line)).toEqual([3, 4]);
        });

        it('accepts the shared bound and the suite ceiling', () => {
            const { waits } = analyzeSynthetic(
                'await expect(page.getByLabel(LAUNCH_SCREEN_NAME)).toBeVisible({ timeout: LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS });',
                'await page.getByLabel(LAUNCH_SCREEN_NAME).waitFor({ state: "visible" });'
            );

            expect(waits).toHaveLength(2);
            expect(waitsOffTheBound(waits)).toEqual([]);
        });

        it('ignores a comment or string naming the label above an unrelated short wait', () => {
            const { waits } = analyzeSynthetic(
                '// Sourdaw — start a project appears first; LAUNCH_SCREEN_NAME is the label.',
                "const note = 'Sourdaw — start a project';",
                'await expect(page.locator("#other")).toBeVisible({ timeout: 5_000 });'
            );

            expect(waits).toEqual([]);
        });

        it('keeps a same-named const in a sibling test bound to its own locator', () => {
            const { waits } = analyzeSynthetic(
                "test('first', async ({ page }) => {",
                '    const screen = page.getByLabel(LAUNCH_SCREEN_NAME);',
                '    await expect(screen).toBeVisible();',
                '});',
                "test('second', async ({ page }) => {",
                "    const screen = page.getByRole('button', { name: 'Play' });",
                '    await expect(screen).toBeVisible({ timeout: 5_000 });',
                '});'
            );

            expect(waits).toEqual([{ line: 3, timeout: undefined }]);
        });

        it('does not judge an unrelated wait inside an overlay isVisible branch', () => {
            const { waits } = analyzeSynthetic(
                "const overlay = page.getByLabel('Sourdaw — start a project');",
                'if (await overlay.isVisible()) {',
                "    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible({ timeout: 5_000 });",
                '}'
            );

            expect(waits).toEqual([]);
        });

        it('does not judge a wait on a child locator of the overlay', () => {
            const { waits } = analyzeSynthetic(
                'const overlay = page.getByLabel(LAUNCH_SCREEN_NAME);',
                "await expect(overlay.getByRole('button', { name: 'New' })).toBeVisible({ timeout: 5_000 });",
                "await overlay.locator('#launch-new-project').waitFor({ timeout: 5_000 });"
            );

            expect(waits).toEqual([]);
        });

        it('does not judge waits for the overlay to disappear', () => {
            const { waits } = analyzeSynthetic(
                'const overlay = page.getByLabel(LAUNCH_SCREEN_NAME);',
                'await expect(overlay).toBeHidden({ timeout: 5_000 });',
                'await expect(overlay).not.toBeVisible({ timeout: 5_000 });',
                'await expect(overlay).toHaveCount(0, { timeout: 5_000 });',
                "await overlay.waitFor({ state: 'hidden', timeout: 5_000 });",
                "await overlay.waitFor({ state: 'detached', timeout: 5_000 });"
            );

            expect(waits).toEqual([]);
        });

        it('reads the first-paint argument of launch_new_project from code, not comments', () => {
            const { firstPaintArguments } = analyzeSynthetic(
                '// firstPaintTimeoutMs: 1_000 is the old value',
                'await openNewProject(page, { firstPaintTimeoutMs: 90_000 });'
            );

            expect(firstPaintArguments).toEqual([{ line: 2, milliseconds: 90_000 }]);
        });
    });
});
