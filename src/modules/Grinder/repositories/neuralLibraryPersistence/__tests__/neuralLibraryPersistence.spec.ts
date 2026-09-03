import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type GrinderImportedNeuralModel } from '../../../models/GrinderPatch';
import { downloadGrinderNeuralModelFile } from '../downloadGrinderNeuralModelFile';
import { persistGrinderNeuralLibrary } from '../persistGrinderNeuralLibrary';
import { restoreGrinderNeuralLibraryResult } from '../restoreGrinderNeuralLibrary';

function make_entry(overrides: Partial<GrinderImportedNeuralModel> = {}): GrinderImportedNeuralModel {
    return {
        id: overrides.id ?? 'imported-1',
        source: 'imported',
        name: overrides.name ?? 'Imported One',
        family: 'NAM import',
        placement: 'amp-capture',
        description: 'Imported from one.nam',
        importedAt: overrides.importedAt ?? 1,
        sourceFileName: overrides.sourceFileName ?? 'one.nam',
        sourceFileText: overrides.sourceFileText ?? '{"name":"one"}',
        profile: {
            derivedFrom: 'nam',
            sourceArchitecture: 'WaveNet',
            sourceSampleRate: 48_000,
            sourceWeightCount: 12,
            preferredTier: 'standard',
            inputDrive: 1.1,
            asymmetry: 0.02,
            outputTrim: 0.9,
            contourMix: 0.2,
            recurrentBias: 0.01,
            convWeights: [[0.1, 0.7, 0.2]],
        },
        ...overrides,
    };
}

/**
 * Minimal in-memory IndexedDB fake covering the surface the neural-library
 * repos use: open (+ onupgradeneeded), readonly/readwrite transactions, and
 * objectStore.get/put. A `failOn` hook lets a test inject a transaction-level
 * DOMException to exercise the differentiated error channel.
 */
function installFakeIndexedDb(options: { failOn?: () => DOMException } = {}): Map<string, unknown> {
    const backing = new Map<string, unknown>();

    function makeRequest<T>(run: () => T) {
        const req: {
            result: T | undefined;
            error: unknown;
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
        } = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
            try {
                req.result = run();
                req.onsuccess?.();
            } catch (error) {
                req.error = error;
                req.onerror?.();
            }
        });
        return req;
    }

    const objectStore = {
        get: (key: string) =>
            makeRequest(() => {
                const failure = options.failOn?.();
                if (failure) {
                    throw failure;
                }
                return backing.has(key) ? backing.get(key) : null;
            }),
        put: (value: unknown, key: string) =>
            makeRequest(() => {
                backing.set(key, value);
                return undefined;
            }),
    };

    function makeTransaction() {
        const tx: {
            error: unknown;
            oncomplete: (() => void) | null;
            onerror: (() => void) | null;
            objectStore: () => typeof objectStore;
        } = {
            error: null,
            oncomplete: null,
            onerror: null,
            objectStore: () => objectStore,
        };
        queueMicrotask(() => {
            const failure = options.failOn?.();
            if (failure) {
                tx.error = failure;
                tx.onerror?.();
                return;
            }
            tx.oncomplete?.();
        });
        return tx;
    }

    const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => objectStore,
        transaction: () => makeTransaction(),
        close: () => {},
    };

    const indexedDB = {
        open: () => {
            const req: {
                result: typeof db;
                error: unknown;
                onsuccess: (() => void) | null;
                onerror: (() => void) | null;
                onupgradeneeded: (() => void) | null;
            } = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
            queueMicrotask(() => req.onsuccess?.());
            return req;
        },
    };

    vi.stubGlobal('indexedDB', indexedDB);
    return backing;
}

describe('neuralLibraryPersistence', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    describe('downloadGrinderNeuralModelFile', () => {
        it('should defer revoking the object URL until after the click task completes', () => {
            // Regression for NEW-5: revoking synchronously after click() cancels
            // large-file exports in Safari because the blob read has not started.
            vi.useFakeTimers();
            const createObjectURL = vi.fn(() => 'blob:fake-url');
            const revokeObjectURL = vi.fn();
            vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
            const anchor = document.createElement('a');
            const click = vi.spyOn(anchor, 'click').mockImplementation(() => {});
            vi.spyOn(document, 'createElement').mockReturnValue(anchor);

            downloadGrinderNeuralModelFile({ file_name: 'capture.nam', file_text: '{"name":"x"}' });

            // The URL must still be live the instant click() returns.
            expect(click).toHaveBeenCalledTimes(1);
            expect(anchor.href).toBe('blob:fake-url');
            expect(anchor.download).toBe('capture.nam');
            expect(revokeObjectURL).not.toHaveBeenCalled();

            // It is released only after the deferred task runs.
            vi.advanceTimersByTime(1000);
            expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:fake-url');
            expect(anchor.parentNode).toBeNull();

            vi.restoreAllMocks();
        });
    });

    describe('persistGrinderNeuralLibrary', () => {
        beforeEach(() => {
            installFakeIndexedDb();
        });

        it('should report success with a discriminated result', async () => {
            const result = await persistGrinderNeuralLibrary({ entries: [make_entry()] });
            expect(result).toEqual({ ok: true });
        });

        it('should refuse oversized payloads with a quota_exceeded error before writing', async () => {
            // Regression for #27: the full multi-MB source text is written with no
            // quota guard. A payload past the budget must be rejected up front.
            const huge = 'x'.repeat(30 * 1024 * 1024);
            const result = await persistGrinderNeuralLibrary({
                entries: [make_entry({ id: 'a', sourceFileText: huge }), make_entry({ id: 'b', sourceFileText: huge })],
            });

            expect(result.ok).toBe(false);
            expect(result.ok === false && result.error.code).toBe('quota_exceeded');
        });

        it('should differentiate a quota DOMException from the transaction', async () => {
            vi.unstubAllGlobals();
            installFakeIndexedDb({ failOn: () => new DOMException('full', 'QuotaExceededError') });

            const result = await persistGrinderNeuralLibrary({ entries: [make_entry()] });

            expect(result.ok).toBe(false);
            expect(result.ok === false && result.error.code).toBe('quota_exceeded');
        });

        it('should differentiate a schema DOMException from the transaction', async () => {
            vi.unstubAllGlobals();
            installFakeIndexedDb({ failOn: () => new DOMException('bad version', 'VersionError') });

            const result = await persistGrinderNeuralLibrary({ entries: [make_entry()] });

            expect(result.ok).toBe(false);
            expect(result.ok === false && result.error.code).toBe('schema_mismatch');
        });

        it('should differentiate a permission DOMException from the transaction', async () => {
            vi.unstubAllGlobals();
            installFakeIndexedDb({ failOn: () => new DOMException('blocked', 'SecurityError') });

            const result = await persistGrinderNeuralLibrary({ entries: [make_entry()] });

            expect(result.ok).toBe(false);
            expect(result.ok === false && result.error.code).toBe('permission_denied');
        });
    });

    describe('restoreGrinderNeuralLibraryResult', () => {
        it('should return persisted entries on success', async () => {
            const backing = installFakeIndexedDb();
            backing.set('entries', [make_entry({ id: 'restored' })]);

            const result = await restoreGrinderNeuralLibraryResult();

            expect(result.ok).toBe(true);
            expect(result.ok === true && result.entries.map((entry) => entry.id)).toEqual(['restored']);
        });

        it('should surface a differentiated error instead of silently returning an empty list', async () => {
            // Regression for #22: every failure used to collapse to `[]`, hiding
            // quota / schema / permission problems from the caller.
            installFakeIndexedDb({ failOn: () => new DOMException('blocked', 'SecurityError') });

            const result = await restoreGrinderNeuralLibraryResult();

            expect(result.ok).toBe(false);
            expect(result.ok === false && result.error.code).toBe('permission_denied');
        });
    });
});
