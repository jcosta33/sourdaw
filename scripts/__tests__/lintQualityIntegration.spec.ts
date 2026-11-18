import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseQualityReport, QUALITY_BUDGET, QUALITY_CONFIG } from '../lintQualityBudget';
import { buildQualityLintArgv } from '../runLint';

const root = resolve(import.meta.dirname, '../..');

function isolateTypeScriptProject(directory: string, parent: string, files: string[]) {
    writeFileSync(
        join(directory, 'tsconfig.json'),
        JSON.stringify({ extends: resolve(root, parent), files, include: [], exclude: [] })
    );
}

describe('production quality lint', () => {
    it('observes typed, Vitest and Playwright failures from one real CLI pass', () => {
        const scripts = mkdtempSync(join(root, 'scripts/lint-quality-probe-'));
        const e2e = mkdtempSync(join(root, 'tests/e2e/lint-quality-probe-'));
        const source = mkdtempSync(join(root, 'src/lint-quality-probe-'));
        try {
            const runTime = join(scripts, 'typed.ts');
            const unit = join(scripts, 'unit.spec.ts');
            const browser = join(e2e, 'browser.spec.ts');
            const unitHelper = join(scripts, '__tests__/unitHelper.ts');
            const sourceHelper = join(source, 'testing/sourceHelper.ts');
            mkdirSync(join(scripts, '__tests__'));
            mkdirSync(join(source, 'testing'));
            // Type-aware lint must not enumerate other tests' transient files while they are removed.
            isolateTypeScriptProject(scripts, 'scripts/tsconfig.json', [
                'typed.ts',
                'unit.spec.ts',
                '__tests__/unitHelper.ts',
            ]);
            isolateTypeScriptProject(source, 'tsconfig.json', ['testing/sourceHelper.ts']);
            isolateTypeScriptProject(e2e, 'tests/tsconfig.json', ['browser.spec.ts']);
            writeFileSync(
                runTime,
                `
                export function missing(value: 'start' | 'stop') {
                    switch (value) {
                        case 'start': return 1;
                        default: return 0;
                    }
                }
                export function complete(value: 'start' | 'stop') {
                    switch (value) {
                        case 'start': return 1;
                        case 'stop': return 0;
                        default: throw new Error('unexpected');
                    }
                }
                export function acceptsOpenString(value: string) {
                    switch (value) {
                        case 'start': return 1;
                        default: return 0;
                    }
                }
                export async function runtimeTimer() {
                    await new Promise<void>((complete) => setTimeout(complete, 10));
                }
                export function runtimeTimerPromise(ms: number) {
                    return new Promise<void>((complete) => setTimeout(complete, ms));
                }
                export function catchesQuietly(run: () => void) {
                    try { run(); } catch { /* ignore */ }
                }
                export function handlesCancellation(run: () => void) {
                    try { run(); } catch (error) {
                        if (!(error instanceof DOMException && error.name === 'AbortError')) { throw error; }
                    }
                }
                export function hidesFailure(run: () => { ok: boolean }) {
                    try { return run(); } catch { return { ok: true }; }
                }
                export function replacesObservedPromise(promise: Promise<void>) {
                    void promise.catch(() => {}); // original promise is discarded
                    return { promise, ...{ promise: Promise.resolve() } };
                }
                export function restoresObservedPromise(promise: Promise<void>) {
                    void promise.catch(() => {});
                    return { ...{ promise: Promise.resolve() }, promise } as const;
                }
                export async function interceptsAwaitedPromise(promise: Promise<void>) {
                    try {
                        void promise.catch(() => {}); // awaited rejection is handled locally
                        return await promise;
                    } catch (error) {
                        console.error(error);
                    }
                }
                export async function rethrowsAwaitedPromise(promise: Promise<void>) {
                    try {
                        void promise.catch(() => {});
                        return await promise;
                    } catch (error) {
                        console.error(error);
                        throw error;
                    }
                }
                export async function interceptsAnotherReturnedAwait(promise: Promise<void>, other: Promise<void>) {
                    try {
                        void promise.catch(() => {}); // another rejection prevents the return
                        return { promise, other: await other };
                    } catch (error) {
                        console.error(error);
                    }
                }
                export async function interceptsAnotherPrecedingAwait(promise: Promise<void>, other: Promise<void>) {
                    try {
                        void promise.catch(() => {}); // another rejection skips the later return
                        const status = await other;
                        return { promise, status };
                    } catch (error) {
                        console.error(error);
                    }
                }
                export async function handlesAnAwaitBeforeReturning(promise: Promise<void>, other: Promise<void>) {
                    try {
                        void promise.catch(() => {});
                        try {
                            await other;
                        } catch (error) {
                            console.error(error);
                        }
                        return { promise } as const;
                    } catch (error) {
                        console.error(error);
                    }
                }
                export function returnsFailure(run: () => { ok: boolean }) {
                    try { return run(); } catch { return { ok: true, ...{ ok: false } }; }
                }
                export function returnsSuccess(run: () => { ok: boolean }) {
                    try { return run(); } catch { return { ok: false, ...{ ok: true } }; }
                }
                export function optionalStorage(read: () => string) {
                    try { return read(); } catch { return null; }
                }
                export function assertsPayload(text: string) {
                    return JSON.parse(text) as { name: string };
                }
                export function narrowsPayload(text: string) {
                    const raw: unknown = JSON.parse(text);
                    if (typeof raw === 'string') { return raw; }
                    return null;
                }
                export function copiesWithoutChange(record: { name: string }) {
                    return { ...record };
                }
                export function copiesWithChange(record: { name: string }) {
                    return { ...record, name: 'new' };
                }
            `
            );
            writeFileSync(
                unit,
                `
                import { expect, it, vi } from 'vitest';
                it('keeps malformed assertions red', () => {
                    expect(true).toBeDefined;
                });
                it('keeps floating assertion failures red', () => {
                    expect(Promise.resolve(true)).resolves.toBe(true);
                });
                it('keeps conditional assertions red', () => {
                    if (Math.random() > 0.5) { expect(true).toBe(true); }
                });
                it('accepts capture before progressing fake timers', async () => {
                    const task = Promise.resolve(true);
                    const assertion = expect(task, 'context').resolves.toBe(true);
                    await vi.advanceTimersByTimeAsync(10);
                    await assertion;
                });
                it('accepts an awaited assertion through erased TypeScript wrappers', async () => {
                    await (expect(Promise.resolve(true)).resolves.toBe(true) satisfies Promise<unknown>);
                });
                it('refuses a caught assertion failure', async () => {
                    try {
                        await expect(Promise.resolve(1)).resolves.toBe(2);
                    } catch (error) {
                        console.error(error);
                    }
                });
                it('accepts a caught and rethrown assertion failure', async () => {
                    try {
                        await expect(Promise.resolve(true)).resolves.toBe(true);
                    } catch (error) {
                        console.error(error);
                        throw error;
                    }
                });
                it('accepts assertion failure with internally handled cleanup', async () => {
                    try {
                        await expect(Promise.resolve(true)).resolves.toBe(true);
                    } finally {
                        try {
                            throw new Error('cleanup');
                        } catch (error) {
                            console.error(error);
                        }
                    }
                });
                it.each([1, 2])('accepts an expectation per case', (value) => {
                    const observed = value > 1 ? 2 : 1;
                    expect(observed).toBe(value);
                });
                it('refuses a fixed synchronization delay', async () => {
                    await new Promise<void>((complete) => setTimeout(complete, 10));
                    expect(true).toBe(true);
                });
            `
            );
            writeFileSync(
                browser,
                `
                import { test as scenario, expect } from '../e2eTest';
                scenario('required entry', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (await entry.isVisible().catch(() => false)) {
                        await expect(entry).toBeVisible();
                    }
                });
                scenario('required step entry', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (await entry.isVisible()) {
                        await scenario.step('mandatory', async () => {
                            await expect(entry).toBeVisible();
                        });
                    }
                });
                scenario('silent absent branch', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (await entry.isVisible()) {
                        await expect(entry).toBeVisible();
                    } else {
                        console.log('missing');
                    }
                });
                scenario('asserted absent branch', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (await entry.isVisible()) {
                        await expect(entry).toBeVisible();
                    } else {
                        await expect(page.getByRole('alert')).toBeVisible();
                    }
                });
                scenario('required entry inside a nested branch', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (page) {
                        if (await entry.isVisible()) {
                            await expect(entry).toBeVisible();
                        }
                    }
                });
                scenario('required guard inside a wrapped step', async ({ page }) => {
                    const entry = page.getByRole('button');
                    await (scenario.step('mandatory', async () => {
                        if (await entry.isVisible()) {
                            await expect(entry).toBeVisible();
                        }
                    }) satisfies Promise<unknown>);
                });
                scenario('nested branch with an unconditional assertion', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (page) {
                        if (!(await entry.isVisible())) { await page.reload(); }
                        await expect(entry).toBeVisible();
                    }
                });
                scenario('nested branch fails when the required entry is missing', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (page) {
                        if (await entry.isVisible()) {
                            await expect(entry).toBeVisible();
                        } else {
                            throw new Error('missing required entry');
                        }
                    }
                });
                scenario('required wrapped step entry', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (await entry.isVisible()) {
                        await (scenario.step('mandatory', async () => {
                            await expect(entry).toBeVisible();
                        }) satisfies Promise<unknown>);
                    }
                });
                scenario('conditionally retry', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (!(await entry.isVisible())) { await page.reload(); }
                    await (scenario.step('mandatory', async () => { await expect(entry).toBeVisible(); }) satisfies Promise<unknown>);
                    // oxlint-disable-next-line sourdaw-craft/no-fixed-test-sleep -- Observe a real absence window.
                    await page.waitForTimeout(25);
                });
                scenario('negative immutable guard skips a required entry', async ({ page }) => {
                    const entry = page.getByRole('button');
                    const missing = !(await entry.isVisible());
                    if (missing) { return; } // immutable missing guard skips the assertion
                    await expect(entry).toBeVisible();
                });
                scenario('negative immutable guard retries before an unconditional assertion', async ({ page }) => {
                    const entry = page.getByRole('button');
                    const missing = !(await entry.isVisible());
                    if (missing) { await page.reload(); }
                    await expect(entry).toBeVisible();
                });
                scenario('conditional observer before the required entry', async ({ page }) => {
                    if (process.env.CHECK_READY) { await expect(page.getByRole('status')).toBeVisible(); }
                    const entry = page.getByRole('button');
                    if (await entry.isVisible()) { // earlier observer can be skipped
                        await expect(entry).toBeVisible();
                    }
                });
                scenario('conditional observer after the required entry', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (await entry.isVisible()) { // later observer can be skipped
                        await expect(entry).toBeVisible();
                    }
                    if (process.env.CHECK_READY) { await expect(page.getByRole('status')).toBeVisible(); }
                });
                scenario('observers in both branches', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (await entry.isVisible()) { await expect(entry).toBeVisible(); }
                    if (process.env.CHECK_READY) {
                        await expect(page.getByRole('status')).toBeVisible();
                    } else {
                        await expect(page.getByRole('alert')).toBeVisible();
                    }
                });
                scenario('unconditional observer with cleanup before the guard', async ({ page }) => {
                    const entry = page.getByRole('button');
                    try {
                        await expect(page.getByRole('status')).toBeVisible();
                    } finally {
                        console.log('finished observing readiness');
                    }
                    if (await entry.isVisible()) { await expect(entry).toBeVisible(); }
                });
                scenario('unconditional observer with cleanup after the guard', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (await entry.isVisible()) { await expect(entry).toBeVisible(); }
                    try {
                        await expect(page.getByRole('status')).toBeVisible();
                    } finally {
                        console.log('finished observing readiness');
                    }
                });
                scenario('an unconditional observer rethrows failures', async ({ page }) => {
                    const entry = page.getByRole('button');
                    if (await entry.isVisible()) { await expect(entry).toBeVisible(); }
                    try {
                        await expect(page.getByRole('status')).toBeVisible();
                    } catch (error) {
                        console.error(error);
                        throw error;
                    }
                });
            `
            );
            writeFileSync(
                unitHelper,
                `export const pause = (ms: number) => new Promise<void>((complete) => setTimeout(complete, ms));\n` +
                    `export function deadline<T>(work: Promise<T>) {\n` +
                    '    return Promise.race([work, new Promise((_, reject) => setTimeout(reject, 50))]);\n' +
                    '}\n'
            );
            writeFileSync(
                sourceHelper,
                "import { setTimeout as timer } from 'node:timers/promises';\n" +
                    'export function pause(ms: number) { return timer(ms); }\n'
            );
            const argv = buildQualityLintArgv([runTime, unit, browser, unitHelper, sourceHelper]).slice(2);
            const result = spawnSync(resolve(root, 'node_modules/.bin/oxlint'), argv, {
                cwd: root,
                encoding: 'utf8',
                timeout: 60_000,
            });
            expect(result.error).toBeUndefined();
            expect(result.status, result.stdout + result.stderr).toBe(1);
            const report = parseQualityReport(result.stdout, root);
            expect(report.fileCount).toBe(5);
            const diagnosticLines = (file: string, rule: string) => {
                const lines = readFileSync(file, 'utf8').split('\n');
                return report.diagnostics
                    .filter((entry) => basename(entry.file) === basename(file) && entry.rule === rule)
                    .map(({ line }) => (line === undefined ? undefined : lines[line - 1]?.trim()));
            };
            expect(diagnosticLines(runTime, 'sourdaw-craft/no-failed-operation-success')).toEqual(
                expect.arrayContaining(['try { return run(); } catch { return { ok: false, ...{ ok: true } }; }'])
            );
            expect(diagnosticLines(runTime, 'sourdaw-craft/no-silent-catch')).toEqual(
                expect.arrayContaining([
                    'void promise.catch(() => {}); // original promise is discarded',
                    'void promise.catch(() => {}); // awaited rejection is handled locally',
                    'void promise.catch(() => {}); // another rejection prevents the return',
                    'void promise.catch(() => {}); // another rejection skips the later return',
                ])
            );
            expect(diagnosticLines(browser, 'sourdaw-craft/no-conditional-playwright-admission')).toEqual(
                expect.arrayContaining([
                    'if (await entry.isVisible()) { // earlier observer can be skipped',
                    'if (await entry.isVisible()) { // later observer can be skipped',
                    'if (missing) { return; } // immutable missing guard skips the assertion',
                ])
            );
            expect(
                report.diagnostics.map(({ file, rule }) => [basename(file), rule]).toSorted(),
                `Oxlint stdout:\n${result.stdout}\nOxlint stderr:\n${result.stderr}`
            ).toEqual(
                [
                    ['browser.spec.ts', 'sourdaw-craft/no-conditional-playwright-admission'],
                    ['browser.spec.ts', 'sourdaw-craft/no-conditional-playwright-admission'],
                    ['browser.spec.ts', 'sourdaw-craft/no-conditional-playwright-admission'],
                    ['browser.spec.ts', 'sourdaw-craft/no-conditional-playwright-admission'],
                    ['browser.spec.ts', 'sourdaw-craft/no-conditional-playwright-admission'],
                    ['browser.spec.ts', 'sourdaw-craft/no-conditional-playwright-admission'],
                    ['browser.spec.ts', 'sourdaw-craft/no-conditional-playwright-admission'],
                    ['browser.spec.ts', 'sourdaw-craft/no-conditional-playwright-admission'],
                    ['browser.spec.ts', 'sourdaw-craft/no-conditional-playwright-admission'],
                    ['sourceHelper.ts', 'sourdaw-craft/no-fixed-test-sleep'],
                    ['typed.ts', 'sourdaw-craft/no-external-data-assertion'],
                    ['typed.ts', 'sourdaw-craft/no-failed-operation-success'],
                    ['typed.ts', 'sourdaw-craft/no-failed-operation-success'],
                    ['typed.ts', 'sourdaw-craft/no-silent-catch'],
                    ['typed.ts', 'sourdaw-craft/no-silent-catch'],
                    ['typed.ts', 'sourdaw-craft/no-silent-catch'],
                    ['typed.ts', 'sourdaw-craft/no-silent-catch'],
                    ['typed.ts', 'sourdaw-craft/no-silent-catch'],
                    ['typed.ts', 'sourdaw-craft/no-useless-clone-spread'],
                    ['typed.ts', 'typescript/switch-exhaustiveness-check'],
                    ['unit.spec.ts', 'sourdaw-craft/no-fixed-test-sleep'],
                    ['unit.spec.ts', 'sourdaw-craft/no-invalid-vitest-expect'],
                    ['unit.spec.ts', 'sourdaw-craft/no-invalid-vitest-expect'],
                    ['unit.spec.ts', 'sourdaw-craft/no-invalid-vitest-expect'],
                    ['unit.spec.ts', 'vitest/no-conditional-expect'],
                    ['unitHelper.ts', 'sourdaw-craft/no-fixed-test-sleep'],
                ].toSorted()
            );
        } finally {
            rmSync(scripts, { recursive: true, force: true });
            rmSync(e2e, { recursive: true, force: true });
            rmSync(source, { recursive: true, force: true });
        }
    }, 75_000);

    it('enforces the pilot rules on product code and Vitest cases at their exact boundaries', () => {
        const source = mkdtempSync(join(root, 'src/lint-craft-probe-'));
        const e2e = mkdtempSync(join(root, 'tests/e2e/lint-craft-probe-'));
        try {
            const product = join(source, 'product.tsx');
            const unit = join(source, 'unit.spec.ts');
            const helper = join(source, 'testing/helpers.ts');
            const excluded = join(source, 'browser.e2e.spec.ts');
            const browser = join(e2e, 'browser.spec.ts');
            mkdirSync(join(source, 'testing'));
            isolateTypeScriptProject(source, 'tsconfig.json', [
                'product.tsx',
                'unit.spec.ts',
                'testing/helpers.ts',
                'browser.e2e.spec.ts',
            ]);
            isolateTypeScriptProject(e2e, 'tests/tsconfig.json', ['browser.spec.ts']);
            const decisions = (count: number) => 'if (value) { value -= 1; }\n'.repeat(count);
            writeFileSync(
                product,
                `
import { type HostFlags } from './testing/helpers';
export function flags(enabled: boolean, flush = false) { return enabled || flush; }
export function optionalFlags(enabled: boolean, flush?: boolean) { return enabled || flush; }
export function flag(enabled: boolean) { return enabled; }
export function optionFlags({ enabled, flush }: { enabled: boolean; flush: boolean }) { return enabled || flush; }
export const hostFlags: HostFlags = (enabled: boolean, flush: boolean) => enabled || flush;
type Callback = (enabled: boolean, flush: boolean) => boolean;
declare function subscribe(callback: Callback): void;
subscribe((enabled: boolean, flush: boolean) => enabled || flush);
export function arity(a: number, b: number, c: number, d: number, e: number) { return a + b + c + d + e; }
export function four(a: number, b: number, c: number, d: number) { return a + b + c + d; }
// oxlint-disable-next-line max-params -- The host invokes the callback with five positional fields.
export function hostCallback(a: number, b: number, c: number, d: number, e: number) { return a + b + c + d + e; }
export function assertion(value?: number) { return value!; }
export function narrowed(value?: number) { if (value === undefined) { return 0; } return value; }
export function redundantGeneric<Value>(value: Value): string { return String(value); }
export function identity<Value>(value: Value): Value { return value; }
export function branches(value: number) { ${decisions(12)} }
export function twelve(value: number) { ${decisions(11)} }
export function nesting(value: number) { if (value) { if (value) { if (value) { if (value) { if (value) { return value; } } } } } }
export function eighty(value: number) {
${'value += 1;\n\n// Count only the expression.\n'.repeat(77)}return value;
}
export const longIife = (() => {
let value = 0;
${'value += 1;\n'.repeat(78)}return value;
})();
function step(value: number) { return value + 1; }
declare function defer(callback: () => number): number;
export function heavy(enabled: boolean): number { return enabled ? step(step(step(1))) : step(0); }
export function mixed(enabled: boolean, current: number) { return enabled ? ++current : 0; }
export function deferred(enabled: boolean) { return enabled ? defer(() => step(step(step(1)))) : 0; }
export function simple(enabled: boolean, fixed: string) { return enabled ? String(Number(fixed)) : fixed; }
export function label(enabled: boolean) { return enabled ? <span>on</span> : <span>off</span>; }
export function multilineLabel(enabled: boolean) {
    return enabled
        ? <span>on</span>
        : <span>off</span>;
}
export function multiline(enabled: boolean): number {
    return enabled // Multiline calls still belong to the original rule.
        ? step(step(step(1)))
        : step(0);
}
`
            );
            writeFileSync(
                unit,
                `
import { assert, assertType, expect, expectTypeOf, it, test } from 'vitest';
function observe() { return true; }
it('matchers', () => { expect(observe()).toBe(true); });
test('assert', () => { assert(observe()); });
it('type matcher', () => { expectTypeOf(observe()).toEqualTypeOf<boolean>(); });
test('type assertion', () => { assertType<boolean>(observe()); });
it('assertion-free', () => { observe(); });
export function testHelper(a: number, b: number, c: number, d: number, e?: number) { return a + b + c + d + e!; }
`
            );
            writeFileSync(
                helper,
                `
export type HostFlags = (enabled: boolean, flush: boolean) => boolean;
export function helper(a: number, b: number, c: number, d: number, e: number) { return a + b + c + d + e; }
`
            );
            writeFileSync(excluded, "import { it } from 'vitest';\nit('outside the pilot', () => {});\n");
            writeFileSync(
                browser,
                "import { test } from '@playwright/test';\ntest('browser scope', async () => {});\n"
            );

            const argv = buildQualityLintArgv([product, unit, helper, excluded, browser]).slice(2);
            const result = spawnSync(resolve(root, 'node_modules/.bin/oxlint'), argv, {
                cwd: root,
                encoding: 'utf8',
                timeout: 60_000,
            });
            expect(result.error).toBeUndefined();
            expect(result.status, result.stdout + result.stderr).toBe(1);
            const report = parseQualityReport(result.stdout, root);
            expect(report.fileCount).toBe(5);
            const productLines = readFileSync(product, 'utf8').split('\n');
            const cases = [
                ['eslint/complexity', 'export function branches('],
                ['eslint/max-depth', 'export function nesting('],
                ['eslint/max-lines-per-function', 'export const longIife'],
                ['eslint/max-params', 'export function arity('],
                ['sourdaw-craft/no-complex-ternary-branch', 'export function heavy('],
                ['sourdaw-craft/no-complex-ternary-branch', 'export function mixed('],
                ['sourdaw-craft/no-control-flow-ternary', '    return enabled // Multiline'],
                ['sourdaw-craft/no-positional-boolean-flags', 'export function flags('],
                ['sourdaw-craft/no-positional-boolean-flags', 'export function optionalFlags('],
                ['typescript/no-non-null-assertion', 'export function assertion('],
                ['typescript/no-unnecessary-type-parameters', 'export function redundantGeneric<'],
            ] as const;
            const expected = cases.map(([rule, prefix]) => [
                'product.tsx',
                rule,
                productLines.findIndex((line) => line.startsWith(prefix)) + 1,
            ]);
            expected.push(['unit.spec.ts', 'vitest/expect-expect', 8]);
            expect(report.diagnostics.map(({ file, rule, line }) => [basename(file), rule, line]).toSorted()).toEqual(
                expected.toSorted()
            );
        } finally {
            rmSync(source, { recursive: true, force: true });
            rmSync(e2e, { recursive: true, force: true });
        }
    }, 75_000);

    it('applies the native ternary fix to only the selected file and preserves its effects', () => {
        const scripts = mkdtempSync(join(root, 'scripts/lint-quality-fix-'));
        try {
            const target = join(scripts, 'target.ts');
            const neighbor = join(scripts, 'neighbor.ts');
            const ledgerPath = join(root, QUALITY_BUDGET);
            const ledger = readFileSync(ledgerPath);
            const ternary = "check() ? start('stärt') : await stop();";
            const manual = 'check() ? /* keep this note */ start() : stop();';
            const source = `
const effects = [];
async function run(choice, fail) {
    function check() { effects.push('prüfen'); return choice; }
    function start(label) { effects.push(label); }
    async function stop() {
        effects.push('stop');
        await Promise.resolve();
        effects.push('resumed');
        if (fail) throw new Error('failed');
    }
    ${ternary}
    effects.push('after');
}
function leaveForManualReview() {
    ${manual}
}
await run(true, false);
await run(false, false);
try { await run(false, true); } catch (error) { effects.push(error.message); }
console.log(JSON.stringify(effects));
`;
            writeFileSync(target, source);
            writeFileSync(neighbor, source);
            const runFixture = (code: string) => {
                const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 10_000,
                });
                expect(result.error).toBeUndefined();
                expect(result.status, result.stderr).toBe(0);
                return JSON.parse(result.stdout);
            };
            const fixTarget = () => {
                const result = spawnSync(
                    'pnpm',
                    [
                        'exec',
                        'oxlint',
                        '--config',
                        QUALITY_CONFIG,
                        '--disable-nested-config',
                        '--threads=2',
                        '--fix',
                        '--format=json',
                        target,
                    ],
                    { cwd: root, encoding: 'utf8', timeout: 60_000 }
                );
                expect(result.error).toBeUndefined();
                expect(result.status, result.stdout + result.stderr).toBe(1);
                const report = parseQualityReport(result.stdout, root);
                expect(report.fileCount).toBe(1);
                expect(report.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
                    'sourdaw-craft/no-control-flow-ternary',
                ]);
            };

            const before = runFixture(source);
            expect(before).toEqual([
                'prüfen',
                'stärt',
                'after',
                'prüfen',
                'stop',
                'resumed',
                'after',
                'prüfen',
                'stop',
                'resumed',
                'failed',
            ]);
            fixTarget();
            const fixed = readFileSync(target, 'utf8');
            expect(fixed).toBe(source.replace(ternary, "if (check()) { (start('stärt')); } else { (await stop()); }"));
            expect(runFixture(fixed)).toEqual(before);
            fixTarget();
            expect(readFileSync(target, 'utf8')).toBe(fixed);
            expect(readFileSync(neighbor, 'utf8')).toBe(source);
            expect(readFileSync(ledgerPath)).toEqual(ledger);
        } finally {
            rmSync(scripts, { recursive: true, force: true });
        }
    }, 135_000);

    it('keeps the focused branch and redundant assertion fixes stable through formatting and compilation', () => {
        const directory = mkdtempSync(join(root, 'src/lint-craft-fix-'));
        try {
            const target = join(directory, 'target.ts');
            const neighbor = join(directory, 'neighbor.ts');
            const ledgerPath = join(root, QUALITY_BUDGET);
            const ledger = readFileSync(ledgerPath);
            const eligible =
                "    return check(choice) ? step(step(step(0, 'inner'), 'middle'), 'outer') : step(9, 'else');";
            const source = `const effects: string[] = [];

function step(value: number, label = 'step') {
    effects.push(label);
    return value + 1;
}

function check(choice: boolean) {
    effects.push('check');
    return choice;
}

export function select(choice: boolean): number {
${eligible}
}

export function redundant(value: number) {
    return value!;
}

export function required(value?: number): number {
    return value!;
}

export function inferred(choice: boolean) {
    return choice ? step(step(step(1))) : step(2);
}

export function wrapped(choice: boolean): number {
    return (choice ? step(step(step(3))) : step(4)) satisfies number;
}

function verify(value: unknown): asserts value is string {
    if (typeof value !== 'string') {
        throw new Error('not a string');
    }
}

export function asserted(choice: boolean, value: unknown) {
    choice ? verify(value) : verify(value);
    return value;
}

console.log(JSON.stringify([select(true), select(false), redundant(3), required(4), asserted(false, 'a'), effects]));
`;
            isolateTypeScriptProject(directory, 'tsconfig.app.json', ['target.ts', 'neighbor.ts']);
            writeFileSync(target, source);
            writeFileSync(neighbor, source);

            const execute = (command: string, args: string[], status = 0) => {
                const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 60_000 });
                expect(result.error).toBeUndefined();
                expect(result.status, result.stdout + result.stderr).toBe(status);
                return result.stdout;
            };
            const declaration = () => {
                execute(resolve(root, 'node_modules/.bin/tsc'), [
                    '--ignoreConfig',
                    '--strict',
                    '--skipLibCheck',
                    '--target',
                    'ESNext',
                    '--module',
                    'nodenext',
                    '--declaration',
                    '--emitDeclarationOnly',
                    '--outDir',
                    directory,
                    target,
                ]);
                return readFileSync(join(directory, 'target.d.ts'), 'utf8');
            };

            const runtime = execute(process.execPath, [target]);
            expect(JSON.parse(runtime)).toEqual([
                3,
                10,
                3,
                4,
                'a',
                ['check', 'inner', 'middle', 'outer', 'check', 'else'],
            ]);
            const types = declaration();
            expect(types).toContain('export declare function asserted(choice: boolean, value: unknown): unknown;');

            const oxlint = resolve(root, 'node_modules/.bin/oxlint');
            const productionFix = () =>
                execute(oxlint, [
                    '--config=.oxlintrc.json',
                    '--disable-nested-config',
                    '--threads=2',
                    '--format=json',
                    '--fix',
                    '--allow=all',
                    '--deny=typescript/no-unnecessary-type-assertion',
                    target,
                ]);
            const qualityFix = () => {
                const report = parseQualityReport(
                    execute(oxlint, [...buildQualityLintArgv([]).slice(2), '--fix', target], 1),
                    root
                );
                expect(report.fileCount).toBe(1);
                expect(report.diagnostics.map(({ rule }) => rule).sort()).toEqual([
                    'sourdaw-craft/no-complex-ternary-branch',
                    'sourdaw-craft/no-complex-ternary-branch',
                    'sourdaw-craft/no-control-flow-ternary',
                    'typescript/no-non-null-assertion',
                ]);
            };
            const format = () => execute(resolve(root, 'node_modules/.bin/prettier'), ['--write', target]);
            productionFix();
            const stockFixed = source.replace('    return value!;', '    return value;');
            expect(readFileSync(target, 'utf8')).toBe(stockFixed);
            qualityFix();
            expect(readFileSync(target, 'utf8')).toBe(
                stockFixed.replace(
                    eligible,
                    "    if (check(choice)) { return (step(step(step(0, 'inner'), 'middle'), 'outer')); } else { return (step(9, 'else')); }"
                )
            );
            format();
            const fixed = stockFixed.replace(
                eligible,
                `    if (check(choice)) {
        return step(step(step(0, 'inner'), 'middle'), 'outer');
    } else {
        return step(9, 'else');
    }`
            );
            expect(readFileSync(target, 'utf8')).toBe(fixed);
            expect(execute(process.execPath, [target])).toBe(runtime);
            expect(declaration()).toBe(types);
            productionFix();
            qualityFix();
            format();
            expect(readFileSync(target, 'utf8')).toBe(fixed);
            expect(readFileSync(neighbor, 'utf8')).toBe(source);
            expect(readFileSync(ledgerPath)).toEqual(ledger);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }, 135_000);

    it('keeps the final bytes and the ledger stable across real focused check and fix', () => {
        const e2e = mkdtempSync(join(root, 'tests/e2e/lint-quality-run-'));
        try {
            const fixture = join(e2e, 'quietWindow.spec.ts');
            isolateTypeScriptProject(e2e, 'tests/tsconfig.json', ['quietWindow.spec.ts']);
            const ledgerPath = join(root, QUALITY_BUDGET);
            const ledger = readFileSync(ledgerPath);
            const formatted = `import { expect, test } from '../e2eTest';

test('observes the whole window', async ({ page }) => {
    // eslint-disable-next-line sourdaw-craft/no-fixed-test-sleep -- Observe that no navigation occurs over time.
    await page.waitForTimeout(25);
    expect(page.url()).toBe('about:blank');
});
`;
            writeFileSync(fixture, formatted.replace("'about:blank'", '"about:blank"'));
            const runLint = (fix: boolean) => {
                const args = [resolve(root, 'scripts/runLint.ts')];
                if (fix) {
                    args.push('--fix');
                }
                args.push(fixture);
                return spawnSync(process.execPath, args, {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 75_000,
                });
            };
            const fixed = runLint(true);
            expect(fixed.error).toBeUndefined();
            expect(fixed.status, fixed.stdout + fixed.stderr).toBe(0);
            expect(fixed.stdout).toMatch(/lint: eslint passed[^]*lint: oxlint-quality passed/);
            expect(readFileSync(fixture, 'utf8')).toBe(formatted);
            const checked = runLint(false);
            expect(checked.error).toBeUndefined();
            expect(checked.status, checked.stdout + checked.stderr).toBe(0);
            expect(checked.stdout).toContain('lint: oxlint-quality passed');
            expect(readFileSync(ledgerPath)).toEqual(ledger);

            writeFileSync(fixture, formatted.replace('sourdaw-craft/no-fixed-test-sleep', 'sourdaw-craft/not-a-rule'));
            const unknown = runLint(false);
            expect(unknown.status).toBe(1);
            expect(unknown.stdout + unknown.stderr).toContain('sourdaw-craft/not-a-rule');
            expect(readFileSync(ledgerPath)).toEqual(ledger);
        } finally {
            rmSync(e2e, { recursive: true, force: true });
        }
    }, 225_000);
});
