import {
    change,
    clone,
    Counter,
    free,
    from,
    getActorId,
    getChanges,
    getHeads,
    getObjectId,
    ImmutableString,
    load,
    prepareLoad,
    save,
} from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

describe('staged native document load', () => {
    it('preserves the checked load, native history and registered scalar datatypes', () => {
        const actor = 'aaaaaaaaaaaaaaaa';
        const original = from(
            { rows: [{ id: 'retained', value: 1.25 }], count: new Counter(3), label: new ImmutableString('opaque') },
            { actor }
        );
        const changed = change(clone(original, { actor }), { message: 'Detect', time: 7 }, (draft) => {
            draft.rows.push({ id: 'detected', value: 2.5 });
        });
        const bytes = save(changed);
        const ordinary = load<typeof original>(bytes, { actor });
        const pending = prepareLoad<typeof original>(bytes, { actor });
        const staged = pending.materialize();
        try {
            pending.discard();
            expect(staged).toEqual(ordinary);
            expect(getActorId(staged)).toBe(actor);
            expect(getHeads(staged)).toEqual(getHeads(ordinary));
            expect(getChanges(original, staged)).toEqual(getChanges(original, ordinary));
            expect(getObjectId(staged.rows[0])).toBe(getObjectId(original.rows[0]));
            expect(staged.count).toBeInstanceOf(Counter);
            expect(staged.label).toBeInstanceOf(ImmutableString);
            expect(() => pending.materialize()).toThrow('Prepared load has already settled');
        } finally {
            free(staged);
            free(ordinary);
            free(changed);
            free(original);
        }
    });

    it('discards an unmaterialized native handle idempotently and refuses adoption afterwards', () => {
        const original = from({ value: 1 });
        const pending = prepareLoad(save(original));
        pending.discard();
        expect(() => pending.discard()).not.toThrow();
        expect(() => pending.materialize()).toThrow('Prepared load has already settled');
        free(original);
    });

    it('retains checked loading for truncated content', () => {
        expect(prepareLoad).toBeTypeOf('function');
        const original = from({ value: 'complete' });
        const bytes = save(original);
        expect(() => prepareLoad(bytes.subarray(0, bytes.length - 1))).toThrow();
        free(original);
    });

    it('keeps staged loading on the initialized ESM, slim, CJS and IIFE package instances', () => {
        const output = execFileSync(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `
            import assert from 'node:assert/strict';
            import { readFileSync } from 'node:fs';
            import { createRequire } from 'node:module';
            import { dirname, resolve } from 'node:path';
            import { runInThisContext } from 'node:vm';
            const native = await import('@automerge/automerge');
            const slim = await import('@automerge/automerge/slim');
            assert.equal(native.prepareLoad, slim.prepareLoad);
            const require = createRequire(import.meta.url);
            const root = dirname(dirname(dirname(require.resolve('@automerge/automerge'))));
            const binary = Uint8Array.from(readFileSync(resolve(root, 'dist/automerge.wasm')));
            const verify = (api) => {
                const actor = 'aaaaaaaaaaaaaaaa';
                const original = api.from({ rows: [{ id: 'retained', value: 1.25 }] }, { actor });
                const pending = api.prepareLoad(api.save(original), { actor, freeze: true });
                const actual = pending.materialize();
                pending.discard();
                assert.deepEqual(actual, original);
                assert.equal(api.getActorId(actual), actor);
                assert.deepEqual(api.getHeads(actual), api.getHeads(original));
                assert.equal(Object.isFrozen(actual), true);
                api.free(actual);
                api.free(original);
            };
            verify(native);
            verify(slim);
            verify(require('@automerge/automerge'));
            verify(require(resolve(root, 'dist/cjs/fullfat_base64.cjs')));
            const cjsSlim = require('@automerge/automerge/slim');
            await cjsSlim.initializeWasm(binary);
            verify(cjsSlim);
            globalThis.window = {};
            require(resolve(root, 'dist/cjs/iife.cjs'));
            await window.Automerge.initializeWasm(binary);
            verify(window.Automerge);
            runInThisContext(readFileSync(resolve(root, 'dist/iife/iife.js'), 'utf8'));
            await window.Automerge.initializeWasm(binary);
            verify(window.Automerge);
            process.stdout.write('verified all package entrypoints');
        `,
            ],
            { encoding: 'utf8', cwd: process.cwd() }
        );
        expect(output).toBe('verified all package entrypoints');
    });
});
import { execFileSync } from 'node:child_process';
