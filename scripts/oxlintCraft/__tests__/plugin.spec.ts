import { RuleTester } from 'oxlint/plugins-dev';
import { describe, expect, it } from 'vitest';

import plugin, { type CraftRuleId } from '../plugin.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
    languageOptions: { parserOptions: { lang: 'ts' } },
});

const rules = plugin.rules;

function runCraftRule(name: CraftRuleId, tests: Parameters<RuleTester['run']>[2]): void {
    const rule = rules[name];
    // oxlint/plugins-dev does not export the Rule type that RuleTester.run requires.
    // @ts-expect-error oxlint plugins-dev keeps Rule internal, so the plugin shape cannot name it
    ruleTester.run(name, rule, tests);
}

describe('sourdaw-craft plugin surface', () => {
    it('should register every craft rule under the plugin name', () => {
        expect(plugin.meta.name).toBe('sourdaw-craft');
        expect(Object.keys(rules).sort()).toEqual([
            'no-conditional-empty-spread',
            'no-conditional-playwright-admission',
            'no-control-flow-ternary',
            'no-external-data-assertion',
            'no-failed-operation-success',
            'no-fixed-test-sleep',
            'no-invalid-vitest-expect',
            'no-json-parse-stringify',
            'no-long-array-chain',
            'no-silent-catch',
            'no-spread-clone-array-method',
            'no-useless-clone-spread',
        ]);
    });
});

runCraftRule('no-conditional-empty-spread', {
    valid: [
        'const next = { ...record, field: true };',
        'fn(...args);',
        'const merged = { ...a, ...b };',
        'const copy = { ...record, ...(extras) };',
        'const list = [...items, extra];',
        {
            filename: 'Panel.tsx',
            code: 'const node = <Panel {...props} />;',
        },
    ],
    invalid: [
        {
            code: 'const props = { ...base, ...(open ? { role: "dialog" } : {}) };',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
        {
            code: 'const props = { ...base, ...(open && { role: "dialog" }) };',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
        {
            code: 'fn(...(ready ? extra : []));',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
        {
            filename: 'Panel.tsx',
            code: 'const node = <Panel {...(open ? { role: "dialog" } : {})} />;',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
        {
            filename: 'Panel.tsx',
            code: 'const node = <Panel {...(open && { hidden: true })} />;',
            errors: [{ message: /Do not spread a conditional or logical expression/ }],
        },
    ],
});

runCraftRule('no-useless-clone-spread', {
    valid: [
        'const next = { ...record, field: true };',
        'const merged = { ...a, ...b };',
        'const original = record;',
        'fn(...args);',
    ],
    invalid: [
        {
            code: 'const clone = { ...record };',
            errors: [{ message: /Do not clone with `\{ \.\.\.x \}`/ }],
        },
    ],
});

runCraftRule('no-spread-clone-array-method', {
    valid: [
        'const mapped = notes.map(transpose);',
        'const filtered = notes.filter(isOn);',
        'const concatThenMap = [...notes, extra].map(transpose);',
        'const copy = [...notes];',
    ],
    invalid: [
        {
            code: 'const mapped = [...notes].map(transpose);',
            errors: [{ message: /Do not clone with spread before `\.map`/ }],
        },
        {
            code: 'const filtered = [...notes].filter(isOn);',
            errors: [{ message: /Do not clone with spread before `\.filter`/ }],
        },
    ],
});

runCraftRule('no-json-parse-stringify', {
    valid: [
        'const copy = structuredClone(record);',
        'const parsed = JSON.parse(text);',
        'const text = JSON.stringify(record);',
    ],
    invalid: [
        {
            code: 'const clone = JSON.parse(JSON.stringify(record));',
            errors: [{ message: /Do not clone with JSON\.parse\(JSON\.stringify/ }],
        },
    ],
});

runCraftRule('no-long-array-chain', {
    valid: [
        'const names = tracks.filter(isArmed).map(toName);',
        'const joined = tracks.map(toName).join(",");',
        'const sorted = names.sort();',
    ],
    invalid: [
        {
            code: 'const names = tracks.filter(isArmed).map(toName).sort();',
            errors: [{ message: /Do not chain three or more/ }],
        },
        {
            code: 'const total = events.filter(isNote).map(toVelocity).reduce(sum, 0);',
            errors: [{ message: /Do not chain three or more/ }],
        },
    ],
});

runCraftRule('no-control-flow-ternary', {
    valid: [
        "const label = armed ? 'on' : 'off';",
        'const value = cond ? foo() : bar();',
        {
            filename: 'Panel.tsx',
            code: 'const node = open ? <Dialog /> : <Placeholder />;',
        },
        {
            filename: 'Panel.tsx',
            code: 'const view = <Button className={active ? "on" : "off"} />;',
        },
    ],
    invalid: [
        {
            code: 'armed ? arm() : disarm();',
            errors: [{ message: /Do not use a ternary as a statement/ }],
        },
        {
            code: 'const next =\n    ready\n        ? start()\n        : stop();',
            errors: [{ message: /Do not use a ternary as an if/ }],
        },
    ],
});

runCraftRule('no-silent-catch', {
    valid: [
        'try { work(); } catch (error) { if (!isAbortError(error)) { throw error; } }',
        'try { work(); } catch (error) { report(error); }',
        'pending.catch((error) => { throw error; });',
        'pending.catch(() => recover());',
        'function deferred() { const { promise, resolve } = Promise.withResolvers(); void promise.catch(() => undefined); register(); return { promise, resolve }; }',
        'function cancelled(promise) { if (aborted) { void promise.catch(() => {}); throw abortReason(); } return promise; }',
    ],
    invalid: [
        { code: 'try { work(); } catch {}', errors: [{ message: /empty handler discards/ }] },
        { code: 'try { work(); } catch { /* ignore */ }', errors: [{ message: /empty handler discards/ }] },
        { code: 'work().catch(() => {});', errors: [{ message: /empty handler discards/ }] },
        { code: 'await work().catch(() => undefined);', errors: [{ message: /empty handler discards/ }] },
        { code: 'work()["catch"](() => { return; });', errors: [{ message: /empty handler discards/ }] },
        { code: 'void work().catch(() => void 0);', errors: [{ message: /empty handler discards/ }] },
    ],
});

runCraftRule('no-failed-operation-success', {
    valid: [
        'function read() { try { return storage(); } catch { return null; } }',
        'function read() { try { return storage(); } catch { return []; } }',
        'function hasCollision() { try { return findCollision(); } catch { return true; } }',
        'async function probe() { return await optional().catch(() => false); }',
        'async function load() { return await request().catch(() => retry()); }',
        'function save() { try { create(); } catch (error) { if (isAlreadySaved(error)) { return true; } throw error; } }',
        'function save() { try { create(); } catch { repair(); return { ok: true }; } }',
    ],
    invalid: [
        {
            code: 'function save() { try { create(); } catch { return { ok: true }; } }',
            errors: [{ message: /unconditionally return success/ }],
        },
        { code: 'work().catch(() => ({ success: true }));', errors: [{ message: /unconditionally return success/ }] },
        {
            code: 'work().catch((error) => { console.warn(error); return { ok: true }; });',
            errors: [{ message: /unconditionally return success/ }],
        },
    ],
});

runCraftRule('no-external-data-assertion', {
    valid: [
        'const raw = JSON.parse(text) as unknown;',
        'const option = { kind: "a" } as const;',
        'const raw: unknown = JSON.parse(text); const valid = schema.parse(raw);',
        'const raw: unknown = JSON.parse(text); if (isModel(raw)) { use(raw); }',
        'async function work(client: LocalCache) { return (await client.json()) as Model; }',
        'function work(JSON: DomainParser) { return JSON.parse(raw) as Model; }',
        'async function work(fetch: LocalReader) { const response = await fetch(key); return (await response.json()) as Model; }',
        'async function work(response) { return (await response.json()) as Model; }',
    ],
    invalid: [
        { code: 'const data = JSON.parse(text) as Model;', errors: [{ message: /Validate external data/ }] },
        { code: 'const data = <Model>JSON["parse"](text);', errors: [{ message: /Validate external data/ }] },
        {
            code: 'async function work() { const response = await fetch(url); return (await response.json()) as Model; }',
            errors: [{ message: /Validate external data/ }],
        },
        {
            code: 'async function work(response: Response) { return (await response.json()) as Model; }',
            errors: [{ message: /Validate external data/ }],
        },
        {
            code: 'async function work() { return (await (await fetch(url)).json()) as Model; }',
            errors: [{ message: /Validate external data/ }],
        },
        {
            code: 'import { desktopInvoke as invoke } from "#/utils/desktopBridge"; async function work() { return (await invoke("read")) as Model; }',
            errors: [{ message: /Validate external data/ }],
        },
    ],
});

runCraftRule('no-conditional-playwright-admission', {
    valid: [
        "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await setup(); } await expect(locator).toBeVisible(); });",
        "import { test, expect } from './e2eTest'; async function helper() { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } } test('name', async () => { await helper(); });",
        "import { test, expect } from 'vitest'; test('name', async () => { if (await locator.isVisible()) { expect(value).toBe(1); } });",
        "import { test, expect } from '@playwright/test'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } else { throw new Error('missing'); } });",
    ],
    invalid: [
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible().catch(() => false)) { await expect(locator).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { const entryExists = await locator.isVisible().catch(() => false); if (entryExists) { await expect(locator).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test as scenario, expect as verify } from '@playwright/test'; scenario('name', async () => { if (!(await locator.isVisible())) { return; } await verify(locator).toBeVisible(); });",
            errors: [{ message: /test can finish without asserting/ }],
        },
    ],
});

runCraftRule('no-fixed-test-sleep', {
    valid: [
        'await expect(locator).toBeVisible();',
        'await vi.advanceTimersByTimeAsync(500);',
        'await page.clock.runFor(500);',
        'setTimeout(expire, 500);',
        'await Promise.race([completed, new Promise((resolve) => setTimeout(resolve, 500))]);',
        'function deadline(work) { return Promise.race([work, new Promise((resolve) => setTimeout(resolve, 500))]); }',
        'import { setTimeout as sleep } from "./fakeClock"; await sleep(500);',
        'const setTimeout = makeFakeTimer(); await new Promise((resolve) => setTimeout(resolve, 500));',
    ],
    invalid: [
        { code: 'await page.waitForTimeout(500);', errors: [{ message: /observable outcome/ }] },
        {
            code: 'await new Promise((resolve) => setTimeout(resolve, 50));',
            errors: [{ message: /observable outcome/ }],
        },
        {
            code: 'await new Promise<void>((resolve) => { window.setTimeout(() => resolve(), 0); });',
            errors: [{ message: /observable outcome/ }],
        },
        {
            code: 'import { setTimeout as sleep } from "node:timers/promises"; await sleep(50);',
            errors: [{ message: /observable outcome/ }],
        },
        {
            code: 'const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));',
            errors: [{ message: /observable outcome/ }],
        },
        {
            code: 'import { setTimeout as timer } from "node:timers/promises"; function wait(ms: number) { return timer(ms); }',
            errors: [{ message: /observable outcome/ }],
        },
    ],
});

runCraftRule('no-invalid-vitest-expect', {
    valid: [
        "import { expect } from 'vitest'; expect(value, 'context').toBe(expected);",
        "import { expect } from 'vitest'; expect(value).to.be.true;",
        "import { expect } from 'vitest'; expect.soft(value, 'context').toBe(expected);",
        "import { expect } from 'vitest'; expect.any(String); expect.assertions(1);",
        "import { expect } from 'vitest'; function use(expect) { expect(value); }",
        "import { expect } from 'vitest'; async function test() { await expect(execution).rejects.toThrow('invalid'); }",
        "import { expect } from 'vitest'; function test() { return expect(execution).resolves.toBe(1); }",
        "import { expect as check } from 'vitest'; async function test() { const rejected = check(execution).rejects.toThrow('invalid'); await vi.advanceTimersByTimeAsync(10); await rejected; check(calls).toBe(1); }",
        "import { expect } from 'vitest'; async function test() { const settled = expect(rendering).rejects.toThrow('aborted'); controller.abort(); await vi.advanceTimersByTimeAsync(0); await settled; }",
        "import { expect } from 'vitest'; async function test() { const assertion = expect(execution).rejects.toThrow(); await Promise.all([assertion, completed]); }",
        "import { expect } from 'vitest'; async function test() { await expect.poll(getValue, { interval: 10 }).toBe(2); }",
        "import { expect } from 'vitest'; async function test() { await expect(event).resolves.toBe(2).then(done).finally(cleanup); }",
    ],
    invalid: [
        { code: "import { expect } from 'vitest'; expect().toBe(1);", errors: [{ message: /needs a subject/ }] },
        {
            code: "import { expect } from 'vitest'; expect(1, 'a', 'b').toBe(1);",
            errors: [{ message: /needs a subject/ }],
        },
        { code: "import { expect } from 'vitest'; expect(value);", errors: [{ message: /with a matcher/ }] },
        {
            code: "import { expect } from 'vitest'; expect(value).toBeDefined;",
            errors: [{ message: /with a matcher/ }],
        },
        {
            code: "import { expect } from 'vitest'; expect(execution).rejects.toThrow();",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { const unused = expect(execution).rejects.toThrow(); await advance(); }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { const assertion = expect(execution).rejects.toThrow(); if (ready) { await assertion; } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { const assertion = expect(execution).rejects.toThrow(); { const assertion = Promise.resolve(); await assertion; } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { const assertion = expect(execution).rejects.toThrow(); if (ready) { return; } await assertion; }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { await expect(event).resolves.toBe(2).catch(() => undefined); }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { await expect(event).resolves.toBe(2).then(undefined, () => undefined); }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; expect.poll(getValue).toBe(2);",
            errors: [{ message: /rejection reaches the test/ }],
        },
    ],
});
