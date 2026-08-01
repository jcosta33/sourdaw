import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../__tests__/fakeIndexedDb';

const KEY = 'sourdaw:project:1700000000000';
const JSON_BODY = JSON.stringify({ version: 1, meta: { name: 'Small', updatedAt: 5 } });

describe('writeNamedProjectJsonByKey', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    // AC-1. Mutation: restoring `window.localStorage.setItem(key, json)` in
    // writeNamedProjectJsonByKey reds `expect(localStorage.length).toBe(0)`.
    it('writes no project content to localStorage', async () => {
        const controls = installFakeIndexedDb();
        const { writeNamedProjectJsonByKey } = await import('../writeNamedProjectJsonByKey');

        await writeNamedProjectJsonByKey(KEY, JSON_BODY);

        expect(localStorage.getItem(KEY)).toBeNull();
        expect(localStorage.length).toBe(0);
        expect(controls.values.get(KEY)).toBe(JSON_BODY);
    });

    // AC-2. Mutation: resolving on `request.onsuccess` instead of
    // `transaction.oncomplete` reds `rejects.toThrow(/abort/i)` — the fake fires
    // request success before the abort verdict, exactly as IndexedDB does.
    it('rejects when the transaction aborts after its request reported success', async () => {
        const controls = installFakeIndexedDb();
        controls.abortWrites();
        const { writeNamedProjectJsonByKey } = await import('../writeNamedProjectJsonByKey');

        await expect(writeNamedProjectJsonByKey(KEY, JSON_BODY)).rejects.toThrow(/abort/i);
        expect(controls.values.has(KEY)).toBe(false);
    });

    // AC-2. Mutation: restoring `if (!db) { return; }` in storageSupport's put
    // reds `expect(controls.values.get(KEY)).toBe(JSON_BODY)` — the write is
    // issued while the open is still pending and must be queued, not dropped.
    it('lands a write issued before the database open resolves', async () => {
        const controls = installFakeIndexedDb({ deferOpen: true });
        const { writeNamedProjectJsonByKey } = await import('../writeNamedProjectJsonByKey');

        const write = writeNamedProjectJsonByKey(KEY, JSON_BODY);
        controls.completeOpen();
        await write;

        expect(controls.values.get(KEY)).toBe(JSON_BODY);
    });

    // AC-2. A write that can never be observed must be reported as a failure,
    // not swallowed. Mutation: resolving instead of rejecting when the database
    // is unavailable reds `rejects.toThrow(/unavailable/i)`.
    it('rejects when the database cannot be opened', async () => {
        const controls = installFakeIndexedDb({ deferOpen: true });
        const { writeNamedProjectJsonByKey } = await import('../writeNamedProjectJsonByKey');

        const write = writeNamedProjectJsonByKey(KEY, JSON_BODY);
        controls.failOpen();

        await expect(write).rejects.toThrow(/unavailable/i);
    });
});
