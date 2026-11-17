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
        'function deferred(promise: Promise<string>) { void promise.catch(() => {}); return promise; }',
        'function deferred(promise: Promise<string>) { void promise.catch(() => {}); return Promise.all([promise]); }',
        'function deferred(promise) { void promise.catch(() => {}); return Promise.allSettled([promise]); }',
        'function deferred(promise) { void promise.catch(() => {}); return Promise.resolve(promise); }',
        'function deferred(promise) { void promise.catch(() => {}); return promise.then(transform); }',
        'function deferred(promise) { void promise.catch(() => {}); return promise.finally(cleanup); }',
        'function deferred(promise, ready) { void promise.catch(() => {}); if (ready) { return promise; } else { return Promise.all([promise]); } }',
        'function deferred(promise, items) { void promise.catch(() => {}); for (const item of items) { if (item.skip) { continue; } if (item.stop) { break; } } return promise; }',
        'function deferred(promise) { void promise.catch(() => {}); function inspect() { return undefined; } inspect(); return promise; }',
        'function deferred(promise, replacement) { promise = replacement; void promise.catch(() => {}); return promise; }',
        'function deferred(promise, replacement) { void promise.catch(() => {}); { let promise; promise = replacement; inspect(promise); } return promise; }',
        'function deferred(promise, replacement) { void promise.catch(() => {}); replace(); return promise; function replace() { let promise; promise = replacement; inspect(promise); } }',
        'function owner() { const initialPromise = start(); return function deferred() { void initialPromise.catch(() => {}); return initialPromise; }; }',
        'function owner() { let initialPromise = start(); return function deferred() { void initialPromise.catch(() => {}); return initialPromise; }; }',
        'function cancelled(promise) { if (aborted) { void promise.catch(() => {}); throw abortReason(); } return promise; }',
        'function cancelled(promise) { try { void promise.catch(() => {}); throw abortReason(); } finally { cleanup(); } }',
        'function deferred(promise) { try { void promise.catch(() => {}); return promise; } finally { cleanup(); } }',
        'function cancelled(promise) { try { start(); } catch (error) { void promise.catch(() => {}); throw error; } }',
        'async function observe(promise) { try { await promise; } catch (error) { record(error); } }',
        'function defer(promise) { void promise.catch(() => {}); return { promise, ...{ ready: true } }; }',
        'function defer(promise, replacement) { void promise.catch(() => {}); return { ...{ task: replacement }, task: promise }; }',
        'function defer(promise, other) { void promise.catch(() => {}); return { ...other, ...{ ["task"]: promise } }; }',
        'function restoreNestedWrite(promise, other) { void promise.catch(() => {}); return { ...{ task: null, ...other }, task: promise }; }',
        'async function deferred(promise) { void promise.catch(() => {}); return await promise; }',
        'async function deferred(promise) { try { void promise.catch(() => {}); return await promise; } catch (error) { console.error(error); throw error; } }',
        'async function deferred(promise) { try { void promise.catch(() => {}); return promise; } catch (error) { console.error(error); } }',
        'async function deferred(promise) { try { void promise.catch(() => {}); return await Promise.allSettled([promise]); } catch (error) { console.error(error); } }',
        'async function awaitsPackedObject(promise) { try { void promise.catch(() => {}); return await { promise }; } catch (error) { console.error(error); } }',
        'function deferred(promise) { void promise.catch(() => {}); return { ...{ task: null }, task: promise } as const; }',
    ],
    invalid: [
        {
            code: 'async function deferred(promise) { try { void promise.catch(() => {}); return await promise; } catch (error) { console.error(error); } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'async function deferred(promise) { try { void promise.catch(() => {}); return { value: await promise }; } catch (error) { console.error(error); } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'async function deferred(promise) { try { void promise.catch(() => {}); return { promise, value: await promise }; } catch (error) { console.error(error); } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'async function deferred(promise) { try { void promise.catch(() => {}); return Promise.all([await promise]); } catch (error) { console.error(error); } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'async function deferred(promise) { try { void promise.catch(() => {}); return await Promise.all([promise]); } catch (error) { console.error(error); } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'async function awaitsResolve(promise) { try { void promise.catch(() => {}); return await Promise.resolve(promise); } catch (error) { console.error(error); } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'async function awaitsChain(promise) { try { void promise.catch(() => {}); return await promise.then(transform).finally(cleanup); } catch (error) { console.error(error); } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'async function awaitsBeforeSettling(promise) { try { void promise.catch(() => {}); return await Promise.allSettled([await promise]); } catch (error) { console.error(error); } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function defer(promise, replacement) { void promise.catch(() => {}); return { promise, ...{ promise: replacement } }; }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function defer(promise) { void promise.catch(() => {}); return { task: promise, ...{ task: null } }; }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function defer(promise) { void promise.catch(() => {}); return { task: promise, ["task"]: null }; }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function defer(promise) { void promise.catch(() => {}); return { task: promise, get task() { return null; } }; }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function defer(promise, extra) { void promise.catch(() => {}); return { task: promise, ...extra }; }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function unknownNestedWrite(promise, extra) { void promise.catch(() => {}); return { task: promise, ...{ ready: true, ...extra } }; }',
            errors: [{ message: /empty handler discards/ }],
        },
        { code: 'try { work(); } catch {}', errors: [{ message: /empty handler discards/ }] },
        { code: 'try { work(); } catch { /* ignore */ }', errors: [{ message: /empty handler discards/ }] },
        { code: 'work().catch(() => {});', errors: [{ message: /empty handler discards/ }] },
        { code: 'await work().catch(() => undefined);', errors: [{ message: /empty handler discards/ }] },
        { code: 'work()["catch"](() => { return; });', errors: [{ message: /empty handler discards/ }] },
        { code: 'void work().catch(() => void 0);', errors: [{ message: /empty handler discards/ }] },
        {
            code: 'function deferred(promise) { void promise.catch(() => {}); return Promise.all([promise.catch(() => undefined)]); }',
            errors: [{ message: /empty handler discards/ }, { message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, other) { void promise.catch(() => {}); return Promise.all([other]); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, Promise) { void promise.catch(() => {}); return Promise.all([promise]); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise) { void promise.catch(() => {}); return Promise.allSettled([promise]).then(() => undefined); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, Promise) { void promise.catch(() => {}); return Promise.resolve(promise); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise) { void promise.catch(() => {}); return promise.then(transform, () => undefined); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, other) { void promise.catch(() => {}); return Promise.race([promise, other]); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, other) { void promise.catch(() => {}); return Promise.any([promise, other]); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, stop) { void promise.catch(() => {}); if (stop) { return; } return promise; }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, stop) { void promise.catch(() => {}); if (stop) { return; } return Promise.all([promise]); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, stop) { void promise.catch(() => {}); if (stop) { return { done: true }; } return { promise }; }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, other, stop) { void promise.catch(() => {}); if (stop) { const promise = other; return Promise.all([promise]); } return promise; }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, items) { for (const item of items) { void promise.catch(() => {}); if (item.skip) { continue; } return promise; } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, replacement) { void promise.catch(() => {}); promise = replacement; return promise; }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, replacement) { void promise.catch(() => {}); promise = replacement; return Promise.all([promise]); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, replacement) { void promise.catch(() => {}); replace(); return promise; function replace() { promise = replacement; } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, replacement) { function replace() { promise = replacement; } void promise.catch(() => {}); replace(); return Promise.all([promise]); }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise) { try { void promise.catch(() => {}); throw new Error("stop"); } catch (error) { log(error); return undefined; } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, stop) { try { void promise.catch(() => {}); if (stop) { throw new Error("stop"); } return promise; } catch (error) { log(error); return undefined; } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise) { try { void promise.catch(() => {}); throw new Error("stop"); } finally { cleanup(); return undefined; } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise, stop) { try { void promise.catch(() => {}); if (stop) { throw new Error("stop"); } return promise; } finally { cleanup(); return undefined; } }',
            errors: [{ message: /empty handler discards/ }],
        },
        {
            code: 'function deferred(promise) { try { void promise.catch(() => {}); return promise; } finally { cleanup(); return undefined; } }',
            errors: [{ message: /empty handler discards/ }],
        },
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
        'function save() { try { return create(); } catch { return { ok: false } as Result; } }',
        'work().catch(() => ({ ok: true, ...{ ok: false } }));',
        'work().catch(() => ({ ok: true, ["ok"]: false }));',
        'work().catch(() => ({ ok: true, get ok() { return false; } }));',
        'work().catch(() => ({ ok: true, ...unknownResult }));',
    ],
    invalid: [
        {
            code: 'work().catch(() => ({ ok: false, ...{ ["ok"]: true } }));',
            errors: [{ message: /unconditionally return success/ }],
        },
        {
            code: 'work().catch(() => ({ ok: true, ...{ ok: false }, ["ok"]: true }));',
            errors: [{ message: /unconditionally return success/ }],
        },
        {
            code: 'work().catch(() => ({ ...unknownResult, success: true }));',
            errors: [{ message: /unconditionally return success/ }],
        },
        {
            code: 'function save() { try { create(); } catch { return { ok: true }; } }',
            errors: [{ message: /unconditionally return success/ }],
        },
        { code: 'work().catch(() => ({ success: true }));', errors: [{ message: /unconditionally return success/ }] },
        {
            code: 'work().catch((error) => { console.warn(error); return { ok: true }; });',
            errors: [{ message: /unconditionally return success/ }],
        },
        {
            code: 'function save() { try { return create(); } catch { return { ok: true } as Result; } }',
            errors: [{ message: /unconditionally return success/ }],
        },
        {
            code: 'work().catch(() => <Result>({ success: true }));',
            errors: [{ message: /unconditionally return success/ }],
        },
        {
            code: 'work().catch(() => ({ ok: (true as const) satisfies true } satisfies Result));',
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
        "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } else { await expect(fallback).toBeVisible(); } });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (!(await locator.isVisible())) { await expect(fallback).toBeVisible(); return; } await expect(locator).toBeVisible(); });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } else { await test.step('fallback', async () => { await expect(fallback).toBeVisible(); }); } });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } else { console.log('missing'); } await expect(ready).toBeVisible(); });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (!(await locator.isVisible())) { await setup(); } await test.step('required', async () => { await expect(locator).toBeVisible(); }); });",
        "import { test, expect } from './e2eTest'; test('name', async () => { const helper = async () => { if (await locator.isVisible()) { await test.step('unused', async () => { await expect(locator).toBeVisible(); }); } }; await setup(); });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (!(await locator.isVisible())) { await setup(); } await (test.step('required', async () => { await expect(locator).toBeVisible(); }) satisfies Promise<unknown>); });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (page) { if (await locator.isVisible()) { await setup(); } await expect(locator).toBeVisible(); } });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (page) { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } else { throw new Error('missing'); } } });",
        "import { test, expect } from './e2eTest'; test('name', async () => { await customStep('unrelated', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } }); });",
        "import { test as scenario, expect as verify } from '@playwright/test'; scenario('name', async () => { const scenario = unrelated; await scenario.step('unrelated', async () => { if (await locator.isVisible()) { await verify(locator).toBeVisible(); } }); });",
        "import { test as scenario, expect as verify } from '@playwright/test'; scenario('name', async () => { await (scenario.step('optional setup', async () => { if (!(await locator.isVisible())) { return; } await verify(locator).toBeVisible(); }) satisfies Promise<unknown>); await verify(ready).toBeVisible(); });",
        "import { test, expect } from './e2eTest'; test('name', async () => { await expect(ready).toBeVisible(); if (await locator.isVisible()) { await expect(locator).toBeVisible(); } });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (ready) { await expect(first).toBeVisible(); } else { await expect(second).toBeVisible(); } if (await locator.isVisible()) { await expect(locator).toBeVisible(); } });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } if (ready) { await expect(first).toBeVisible(); } else { await expect(second).toBeVisible(); } });",
        "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } await test.step('required', async () => { await expect(ready).toBeVisible(); }); });",
        "import { test, expect } from './e2eTest'; test('observer after loop exit', async () => { for (const locator of entries) { if (!(await locator.isVisible())) { continue; } await expect(locator).toBeVisible(); } await expect(ready).toBeVisible(); });",
        "import { test, expect } from './e2eTest'; test('observer after switch exit', async () => { switch (kind) { case 'entry': if (!(await locator.isVisible())) { break; } await expect(locator).toBeVisible(); } await expect(ready).toBeVisible(); });",
        "import { test, expect } from './e2eTest'; test('observes before the guard with cleanup', async () => { try { await expect(ready).toBeVisible(); } finally { cleanup(); } if (await locator.isVisible()) { await expect(locator).toBeVisible(); } });",
        "import { test, expect } from './e2eTest'; test('observes after the guard with cleanup', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } try { await expect(ready).toBeVisible(); } finally { cleanup(); } });",
        "import { test, expect } from './e2eTest'; test('observes before the guard with rethrow', async () => { try { await expect(ready).toBeVisible(); } catch (error) { console.error(error); throw error; } if (await locator.isVisible()) { await expect(locator).toBeVisible(); } });",
        "import { test, expect } from './e2eTest'; test('observes after the guard with rethrow', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } try { await expect(ready).toBeVisible(); } catch (error) { throw error; } });",
    ],
    invalid: [
        {
            code: "import { test, expect } from './e2eTest'; test('can skip observer with cleanup', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } try { if (ready) { await expect(ready).toBeVisible(); } } finally { cleanup(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('catch can skip observer', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } try { await setup(); await expect(ready).toBeVisible(); } catch (error) { console.error(error); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('cleanup can replace observer failure', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } try { await expect(ready).toBeVisible(); } finally { return; } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('loop exit skips observer', async () => { for (const locator of entries) { if (!(await locator.isVisible())) { break; } await expect(locator).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('loop continue skips observer', async () => { for (const locator of entries) { if (!(await locator.isVisible())) { continue; } await expect(locator).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('switch exit skips observer', async () => { switch (kind) { case 'entry': if (!(await locator.isVisible())) { break; } await expect(locator).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (flag) { await expect(ready).toBeVisible(); } if (await locator.isVisible()) { await expect(locator).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } if (flag) { await expect(ready).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { await (test.step('conditional before', async () => { if (flag) { await expect(ready).toBeVisible(); } }) satisfies Promise<unknown>); if (await locator.isVisible()) { await expect(locator).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { await (test.step('optional setup', async () => { if (!(await locator.isVisible())) { return; } await expect(locator).toBeVisible(); }) satisfies Promise<unknown>); if (flag) { await expect(ready).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test as scenario, expect as verify } from '@playwright/test'; scenario('name', async ({ page }) => { if (page) { if (await locator.isVisible()) { await verify(locator).toBeVisible(); } } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { try { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } } finally { cleanup(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { for (const locator of entries) { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { switch (kind) { case 'entry': if (await locator.isVisible()) { await expect(locator).toBeVisible(); } break; } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test as scenario, expect as verify } from '@playwright/test'; scenario('name', async () => { await (scenario.step('required', async () => { if (await locator.isVisible()) { await verify(locator).toBeVisible(); } }) satisfies Promise<unknown>); });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from '@playwright/test'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } else { console.log('missing'); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (!(await locator.isVisible())) { console.log('missing'); } else { await expect(locator).toBeVisible(); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (!(await locator.isVisible())) { console.log('missing'); return; } await expect(locator).toBeVisible(); });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } else { console.log('missing'); } } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } else { if (fallbackReady) { await expect(fallback).toBeVisible(); } } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
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
        {
            code: "import { test as scenario, expect as verify } from '@playwright/test'; scenario('name', async () => { if (await locator.isVisible()) { await scenario.step('outer', async () => { await scenario.step('inner', async () => { await verify(locator).toBeVisible(); }); }); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } { const test = unrelated; await test.step('outside', async () => { await expect(locator).toBeVisible(); }); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } await customStep('outside', async () => { await expect(locator).toBeVisible(); }); });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await (test.step('required', async () => { await expect(locator).toBeVisible(); }) as Promise<unknown>); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test as scenario, expect as verify } from '@playwright/test'; scenario('name', async () => { if (await locator.isVisible()) { await <Promise<unknown>>(scenario.step('outer', async () => { await (scenario.step('inner', async () => { await verify(locator).toBeVisible(); })! satisfies Promise<unknown>); })); } });",
            errors: [{ message: /test can finish without asserting/ }],
        },
        {
            code: "import { test, expect } from './e2eTest'; test('name', async () => { if (await locator.isVisible()) { await expect(locator).toBeVisible(); } void (test.step('outside', async () => { await expect(locator).toBeVisible(); }) satisfies Promise<unknown>); });",
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
        "import { expect } from 'vitest'; async function test() { await (expect(execution).resolves.toBe(1) satisfies Promise<unknown>); }",
        "import { expect } from 'vitest'; async function test() { await expect(execution).resolves.toBe(1)!; }",
        "import { expect } from 'vitest'; function test() { return <Promise<unknown>>expect(execution).resolves.toBe(1); }",
        "import { expect } from 'vitest'; async function test() { const checked = expect(execution).rejects.toThrow() as Promise<unknown>; await vi.advanceTimersByTimeAsync(10); (await (checked satisfies Promise<unknown>)) as unknown; }",
        "import { expect } from 'vitest'; async function test() { const checked = (expect(execution).rejects.toThrow() satisfies Promise<unknown>); await vi.advanceTimersByTimeAsync(10); return await (checked as Promise<unknown>); }",
        "import { expect } from 'vitest'; async function test() { await ((expect(execution).resolves.toBe(1) satisfies Promise<unknown>).then(done) as Promise<unknown>).finally(cleanup); }",
        "import { expect } from 'vitest'; async function test() { await (Promise.all([(expect(execution).resolves.toBe(1) as Promise<unknown>)] satisfies Promise<unknown>[]) satisfies Promise<unknown[]>); }",
        "import { expect, it } from 'vitest'; it('rethrows a failed assertion', async () => { try { await expect(Promise.resolve(1)).resolves.toBe(2); } catch (error) { console.error(error); throw error; } });",
        "import { expect } from 'vitest'; async function test() { try { return expect(execution).resolves.toBe(1); } catch (error) { console.error(error); } }",
        "import { expect } from 'vitest'; async function test() { try { const checked = expect(execution).rejects.toThrow(); await advance(); return (checked satisfies Promise<unknown>); } catch (error) { console.error(error); } }",
        "import { expect } from 'vitest'; async function test() { try { const checked = expect(execution).rejects.toThrow() as Promise<unknown>; await vi.advanceTimersByTimeAsync(10); await (checked satisfies Promise<unknown>); } finally { cleanup(); } }",
        "import { expect } from 'vitest'; async function test() { try { await (Promise.all([expect(execution).resolves.toBe(1)]) satisfies Promise<unknown[]>); } finally { cleanup(); } }",
        "import { expect } from 'vitest'; async function test() { try { await expect(execution).resolves.toBe(1); } finally { throw new Error('cleanup failure'); } }",
        "import { expect } from 'vitest'; async function test() { try { await expect(execution).resolves.toBe(1); } finally { try { throw new Error('handled cleanup failure'); } catch (error) { console.error(error); } } }",
        "import { expect } from 'vitest'; async function test() { try { const checked = expect(execution).rejects.toThrow(); await advance(); await checked; } finally { try { throw new Error('handled cleanup failure'); } catch (error) { console.error(error); } } }",
        "import { expect } from 'vitest'; function test() { try { return expect(execution).resolves.toBe(1); } finally { try { throw new Error('handled cleanup failure'); } catch (error) { console.error(error); } } }",
        "import { expect } from 'vitest'; async function test() { try { setup(); } catch (error) { await expect(execution).resolves.toBe(1); } }",
    ],
    invalid: [
        {
            code: "import { expect, it } from 'vitest'; it('swallows a failed assertion', async () => { try { await expect(Promise.resolve(1)).resolves.toBe(2); } catch (error) { console.error(error); } });",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { try { return await (expect(execution).resolves.toBe(1) satisfies Promise<unknown>); } catch (error) { console.error(error); } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { try { await Promise.all([expect(execution).resolves.toBe(1)]); } finally { return; } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; function test() { try { return Promise.all([expect(execution).resolves.toBe(1)]); } finally { cleanup(); return; } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { try { try { return expect(execution).resolves.toBe(1); } finally { throw new Error('cleanup failure'); } } catch (error) { console.error(error); } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { try { try { return expect(execution).resolves.toBe(1); } finally { try { throw new Error('cleanup failure'); } catch (error) { if (retry) { throw error; } } } } catch (error) { console.error(error); } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { try { const checked = expect(execution).rejects.toThrow() as Promise<unknown>; await advance(); await (checked satisfies Promise<unknown>); } catch (error) { console.error(error); } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { try { const checked = expect(execution).rejects.toThrow(); await advance(); return Promise.all([await checked]); } catch (error) { console.error(error); } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function earliestFailure() { try { const checked = expect(execution).rejects.toThrow(); await checked; return checked; } catch (error) { console.error(error); } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function earliestFailure() { try { const checked = expect(execution).rejects.toThrow(); if (ready) { await checked; } return checked; } catch (error) { console.error(error); } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { try { try { await expect(execution).resolves.toBe(1); } catch (error) { throw error; } } catch (error) { console.error(error); } }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        { code: "import { expect } from 'vitest'; expect().toBe(1);", errors: [{ message: /needs a subject/ }] },
        {
            code: "import { expect } from 'vitest'; function test() { return Promise.allSettled([expect(execution).rejects.toThrow()]); }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; function test() { return (Promise.allSettled([(expect(execution).rejects.toThrow() as Promise<unknown>)]) satisfies Promise<unknown[]>); }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; function test() { (expect(execution).resolves.toBe(1) satisfies Promise<unknown>); }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { await (expect(execution).rejects.toThrow() as Promise<unknown>).then(undefined, () => undefined); }",
            errors: [{ message: /rejection reaches the test/ }],
        },
        {
            code: "import { expect } from 'vitest'; async function test() { await ((expect(execution).rejects.toThrow() satisfies Promise<unknown>).catch(() => undefined))!; }",
            errors: [{ message: /rejection reaches the test/ }],
        },
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
