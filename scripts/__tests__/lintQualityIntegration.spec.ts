import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseQualityReport, QUALITY_BUDGET } from '../lintQualityBudget';
import { buildQualityLintArgv } from '../runLint';

const root = resolve(import.meta.dirname, '../..');

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
                    return { ...{ promise: Promise.resolve() }, promise };
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
            expect(diagnosticLines(runTime, 'sourdaw-craft/no-silent-catch')).toContain(
                'void promise.catch(() => {}); // original promise is discarded'
            );
            expect(diagnosticLines(browser, 'sourdaw-craft/no-conditional-playwright-admission')).toEqual(
                expect.arrayContaining([
                    'if (await entry.isVisible()) { // earlier observer can be skipped',
                    'if (await entry.isVisible()) { // later observer can be skipped',
                ])
            );
            expect(report.diagnostics.map(({ file, rule }) => [basename(file), rule]).toSorted()).toEqual(
                [
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

    it('keeps the final bytes and the ledger stable across real focused check and fix', () => {
        const e2e = mkdtempSync(join(root, 'tests/e2e/lint-quality-run-'));
        try {
            const fixture = join(e2e, 'quietWindow.spec.ts');
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
