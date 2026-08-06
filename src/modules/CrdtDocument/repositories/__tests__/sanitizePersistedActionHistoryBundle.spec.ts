import { describe, expect, it, vi } from 'vitest';

const { mockLoad, mockLoadIncremental, mockSave, mockChange, mockSanitize, mockCompare } = vi.hoisted(() => ({
    mockLoad: vi.fn(),
    mockLoadIncremental: vi.fn(),
    mockSave: vi.fn(() => new Uint8Array([99])),
    mockChange: vi.fn((doc: unknown, fn: (draft: unknown) => void) => {
        fn(doc);
        return doc;
    }),
    mockSanitize: vi.fn(),
    mockCompare: vi.fn(() => 0),
}));

vi.mock('@automerge/automerge', () => ({
    load: mockLoad,
    loadIncremental: mockLoadIncremental,
    save: mockSave,
    change: mockChange,
}));

vi.mock('../../models/ActionHistoryState', () => ({
    sanitize_action_history_state: mockSanitize,
}));

vi.mock('./crdtPersistence/compareIncrementalKeys', () => ({
    compareIncrementalKeys: mockCompare,
}));

import { sanitizePersistedActionHistoryBundle } from '../sanitizePersistedActionHistoryBundle';

function makeBundle(entries: Array<[string, Uint8Array]>): Map<string, Uint8Array> {
    return new Map(entries);
}

describe('sanitizePersistedActionHistoryBundle', () => {
    it('returns unchanged bundle when no documents have action history', () => {
        const bundle = makeBundle([['doc-1', new Uint8Array([1])]]);
        mockLoad.mockReturnValue({ actionHistory: undefined });

        const result = sanitizePersistedActionHistoryBundle({ bundle });

        expect(result.changed).toBe(false);
        expect(result.bundle).toBe(bundle);
    });

    it('returns unchanged bundle when action history is already sanitized (no change)', () => {
        const bundle = makeBundle([['doc-1', new Uint8Array([1])]]);
        const existingHistory = { entries: [], maxSize: 100 };
        mockLoad.mockReturnValue({ actionHistory: existingHistory });
        mockSanitize.mockReturnValue(existingHistory);

        const result = sanitizePersistedActionHistoryBundle({ bundle });

        expect(result.changed).toBe(false);
        expect(result.bundle).toBe(bundle);
    });

    it('sanitizes and re-saves the document when action history needs correction', () => {
        const bundle = makeBundle([['doc-1', new Uint8Array([1])]]);
        const dirtyHistory = { entries: [null, { id: 'a' }], maxSize: 100 };
        const cleanHistory = { entries: [{ id: 'a' }], maxSize: 100 };
        mockLoad.mockReturnValue({ actionHistory: dirtyHistory });
        mockSanitize.mockReturnValue(cleanHistory);

        const result = sanitizePersistedActionHistoryBundle({ bundle });

        expect(result.changed).toBe(true);
        expect(result.bundle).not.toBe(bundle);
        expect(result.bundle.get('doc-1')).toEqual(new Uint8Array([99]));
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(mockChange).toHaveBeenCalledTimes(1);
    });

    it('folds incremental snapshots into the document before checking action history', () => {
        const bundle = makeBundle([
            ['doc-1', new Uint8Array([1])],
            ['doc-1:incremental:2', new Uint8Array([2])],
            ['doc-1:incremental:1', new Uint8Array([3])],
        ]);
        const docAfterLoad = { actionHistory: undefined };
        const docAfterIncremental = { actionHistory: undefined };
        mockLoad.mockReturnValue(docAfterLoad);
        mockLoadIncremental.mockReturnValue(docAfterIncremental);

        sanitizePersistedActionHistoryBundle({ bundle });

        expect(mockLoadIncremental).toHaveBeenCalledTimes(2);
    });

    it('deletes incremental keys when the document is changed', () => {
        const bundle = makeBundle([
            ['doc-1', new Uint8Array([1])],
            ['doc-1:incremental:1', new Uint8Array([2])],
        ]);
        const dirtyHistory = { entries: [null] };
        const cleanHistory = { entries: [] };
        const doc = { actionHistory: dirtyHistory };
        mockLoad.mockReturnValue(doc);
        mockLoadIncremental.mockReturnValue(doc);
        mockSanitize.mockReturnValue(cleanHistory);

        const result = sanitizePersistedActionHistoryBundle({ bundle });

        expect(result.changed).toBe(true);
        expect(result.bundle.has('doc-1:incremental:1')).toBe(false);
        expect(result.bundle.has('doc-1')).toBe(true);
    });

    it('processes multiple documents independently', () => {
        const bundle = makeBundle([
            ['doc-1', new Uint8Array([1])],
            ['doc-2', new Uint8Array([2])],
        ]);
        const dirtyHistory = { entries: [null] };
        const cleanHistory = { entries: [] };
        mockLoad.mockReturnValueOnce({ actionHistory: dirtyHistory }).mockReturnValueOnce({ actionHistory: undefined });
        mockSanitize.mockReturnValue(cleanHistory);

        const result = sanitizePersistedActionHistoryBundle({ bundle });

        expect(result.changed).toBe(true);
        // doc-1 was changed, doc-2 was not
        expect(result.bundle.get('doc-1')).toEqual(new Uint8Array([99]));
    });
});
