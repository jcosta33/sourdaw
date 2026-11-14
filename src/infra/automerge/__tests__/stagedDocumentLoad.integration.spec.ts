import { execFileSync } from 'node:child_process';

import {
    change,
    clone,
    Counter,
    free,
    from,
    getActorId,
    getBackend,
    getChanges,
    getHeads,
    getObjectId,
    ImmutableString,
    load,
    prepareLoad,
    save,
    type Doc,
} from '@automerge/automerge';
import { describe, expect, it, vi } from 'vitest';

type NativeLoadBoundary = Pick<ReturnType<typeof getBackend>, 'materialize' | 'free'>;

function isNativeLoadBoundary(value: unknown): value is NativeLoadBoundary {
    return (
        value !== null &&
        typeof value === 'object' &&
        'materialize' in value &&
        typeof value.materialize === 'function' &&
        'free' in value &&
        typeof value.free === 'function'
    );
}

function nativeLoadPrototype(document: Parameters<typeof getBackend>[0]): NativeLoadBoundary {
    const prototype: unknown = Object.getPrototypeOf(getBackend(document));
    if (!isNativeLoadBoundary(prototype)) {
        throw new Error('Expected initialized native materialize/free prototype');
    }
    return prototype;
}

describe('staged native document load', () => {
    it('defers native root materialization until adoption and transfers native ownership without freeing it', () => {
        const original = from({ value: 1 });
        const bytes = save(original);
        const prototype = nativeLoadPrototype(original);
        const nativeMaterialize = vi.spyOn(prototype, 'materialize');
        const nativeFree = vi.spyOn(prototype, 'free');
        let pending: ReturnType<typeof prepareLoad<{ value: number }>> | undefined;
        let staged: Doc<{ value: number }> | undefined;
        try {
            pending = prepareLoad<{ value: number }>(bytes);
            expect(nativeMaterialize).not.toHaveBeenCalled();
            expect(nativeFree).not.toHaveBeenCalled();
            staged = pending.materialize();
            const adoptedBackend = getBackend(staged);
            expect(nativeMaterialize).toHaveBeenCalledExactlyOnceWith(
                '/',
                undefined,
                expect.objectContaining({ handle: adoptedBackend, heads: undefined, patchCallback: undefined })
            );
            expect(nativeMaterialize.mock.contexts[0]).toBe(adoptedBackend);
            expect(adoptedBackend).not.toBe(getBackend(original));
            pending.discard();
            pending.discard();
            expect(nativeFree).not.toHaveBeenCalled();
            expect(staged.value).toBe(1);
            expect(getHeads(staged)).toEqual(getHeads(original));
        } finally {
            try {
                pending?.discard();
            } finally {
                nativeMaterialize.mockRestore();
                nativeFree.mockRestore();
                if (staged) {
                    free(staged);
                }
                free(original);
            }
        }
    });

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
        const bytes = save(original);
        const prototype = nativeLoadPrototype(original);
        const nativeMaterialize = vi.spyOn(prototype, 'materialize');
        const nativeFree = vi.spyOn(prototype, 'free');
        let pending: ReturnType<typeof prepareLoad> | undefined;
        try {
            pending = prepareLoad(bytes);
            expect(nativeMaterialize).not.toHaveBeenCalled();
            expect(nativeFree).not.toHaveBeenCalled();
            pending.discard();
            expect(nativeFree).toHaveBeenCalledOnce();
            const releasedBackend = nativeFree.mock.contexts[0];
            expect(releasedBackend).not.toBe(getBackend(original));
            expect(Object.getPrototypeOf(releasedBackend)).toBe(prototype);
            expect(() => pending?.discard()).not.toThrow();
            expect(nativeFree).toHaveBeenCalledOnce();
            expect(() => pending?.materialize()).toThrow('Prepared load has already settled');
            expect(nativeMaterialize).not.toHaveBeenCalled();
        } finally {
            try {
                pending?.discard();
            } finally {
                nativeMaterialize.mockRestore();
                nativeFree.mockRestore();
                free(original);
            }
        }
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
            { encoding: 'utf8', cwd: process.cwd(), timeout: 5_000, maxBuffer: 32 * 1024 }
        );
        expect(output).toBe('verified all package entrypoints');
    });
});
