import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';

async function loadSubject() {
    vi.resetModules();
    const createCallbackUndoEntryModule = await import('../../useCases/createCallbackUndoEntry');
    const createUndoEntryModule = await import('../../useCases/createUndoEntry');
    const undoStoreModule = await import('../undoStore');
    return {
        createCallbackUndoEntry: createCallbackUndoEntryModule.createCallbackUndoEntry,
        createUndoEntry: createUndoEntryModule.createUndoEntry,
        pushUndo: undoStoreModule.pushUndo,
        undoStore: undoStoreModule.undoStore,
    };
}

function flushPersistence(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePersistedUndoState(raw: string | null): Record<string, unknown> {
    expect(raw).not.toBeNull();
    if (raw === null) {
        throw new Error('Expected undo session state to persist');
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
        throw new Error('Expected persisted undo state to be an object');
    }
    return parsed;
}

describe('undoStore / pushUndo', () => {
    beforeEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    afterEach(async () => {
        await flushPersistence();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('should append an entry to past and clear future', async () => {
        const { createUndoEntry, pushUndo, undoStore } = await loadSubject();
        const alpha = createUndoEntry(
            'one',
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'setTempo', payload: { bpm: 100 } }
        );
        const b = createUndoEntry('two', { type: 'stopPlayback' }, { type: 'togglePlayback' });
        undoStore.set({ past: [alpha], future: [b] });

        const next = createUndoEntry('three', { type: 'toggleMetronome' }, { type: 'toggleMetronome' });
        pushUndo(next);

        expect(undoStore.value?.past).toEqual([alpha, next]);
        expect(undoStore.value?.future).toEqual([]);
    });

    it('should not mutate when store value is null', async () => {
        const { createUndoEntry, pushUndo, undoStore } = await loadSubject();
        undoStore.set(null);
        const entry = createUndoEntry('x', { type: 'setTempo', payload: { bpm: 1 } }, null);
        pushUndo(entry);
        expect(undoStore.value).toBeNull();
    });

    it('should persist action stacks to sessionStorage when state updates', async () => {
        const { createUndoEntry, pushUndo } = await loadSubject();
        const entry = createUndoEntry(
            'persist',
            { type: 'setMasterGain', payload: { gain: 0.5 } },
            {
                type: 'setMasterGain',
                payload: { gain: 1 },
            }
        );
        pushUndo(entry);

        // Persistence writes are coalesced onto a microtask flush.
        await flushPersistence();

        const parsed = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        if (!Array.isArray(parsed.past) || !Array.isArray(parsed.future)) {
            throw new TypeError('Expected persisted undo stacks to be arrays');
        }
        expect(parsed.future).toEqual([]);
        expect(parsed.past).toHaveLength(1);
        expect(parsed.past[0]).toMatchObject({ id: entry.id, label: 'persist', kind: 'action' });
    });

    it('should not persist restoreDsoSnapshot entries because their bundles are runtime Maps', async () => {
        const { createUndoEntry, pushUndo } = await loadSubject();
        const entry = createUndoEntry(
            'dso snapshot',
            {
                type: 'restoreDsoSnapshot',
                payload: {
                    bundle: new Map([['root', { state: 'present' as const, bytes: new Uint8Array([1, 2, 3]) }]]),
                },
            },
            {
                type: 'restoreDsoSnapshot',
                payload: {
                    bundle: new Map([['root', { state: 'present' as const, bytes: new Uint8Array([4, 5, 6]) }]]),
                },
            }
        );

        pushUndo(entry);
        await flushPersistence();

        const parsed = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        expect(parsed).toEqual({ past: [], future: [] });
    });

    it.each(['callback', 'dso'] as const)(
        'treats a non-persistable %s entry as a causal barrier at both history edges',
        async (barrierKind) => {
            const { createCallbackUndoEntry, createUndoEntry, undoStore } = await loadSubject();
            function actionEntry(id: string) {
                const entry = createUndoEntry(id, { type: 'togglePlayback' }, { type: 'togglePlayback' });
                entry.id = id;
                return entry;
            }
            const barrier =
                barrierKind === 'callback'
                    ? createCallbackUndoEntry({
                          label: 'callback barrier',
                          undo: () => undefined,
                          redo: () => undefined,
                      })
                    : createUndoEntry(
                          'dso barrier',
                          {
                              type: 'restoreDsoSnapshot',
                              payload: {
                                  bundle: new Map([
                                      ['root', { state: 'present' as const, bytes: new Uint8Array([1, 2, 3]) }],
                                  ]),
                              },
                          },
                          null
                      );

            undoStore.set({
                past: [actionEntry('past-causally-older'), barrier, actionEntry('past-safe-suffix')],
                future: [actionEntry('future-safe-prefix'), barrier, actionEntry('future-causally-later')],
            });
            await flushPersistence();

            const parsed = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            if (!Array.isArray(parsed.past) || !Array.isArray(parsed.future)) {
                throw new TypeError('Expected persisted undo stacks to be arrays');
            }
            expect(parsed.past.map((entry) => (isRecord(entry) ? entry.id : undefined))).toEqual(['past-safe-suffix']);
            expect(parsed.future.map((entry) => (isRecord(entry) ? entry.id : undefined))).toEqual([
                'future-safe-prefix',
            ]);
        }
    );

    it('should hydrate valid action entries and default legacy missing kind to action', async () => {
        const legacyEntry = {
            id: 'undo-legacy',
            label: 'Legacy tempo',
            action: { type: 'setTempo', payload: { bpm: 128 } },
            inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
            timestamp: 1000,
            source: 'manual',
        };
        const futureEntry = {
            id: 'undo-future',
            kind: 'action',
            label: 'Future gain',
            action: { type: 'setMasterGain', payload: { gain: 0.4 } },
            inverseAction: null,
            timestamp: 1001,
            source: 'ai',
            groupId: 'group-1',
            groupLabel: 'Group one',
            transactionGroupId: 'group-1',
        };
        const storedFutureEntry = {
            ...futureEntry,
            transactionGroupIndex: 0,
            transactionGroupSize: 1,
        };
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({
                past: [legacyEntry],
                future: [storedFutureEntry],
            })
        );

        const { undoStore } = await loadSubject();

        expect(undoStore.value).toEqual({
            past: [{ ...legacyEntry, kind: 'action' }],
            future: [futureEntry],
        });
    });

    it('keeps the past tail and future head without persisting a partial transaction group', async () => {
        const { createUndoEntry, undoStore } = await loadSubject();
        function entry(id: string, transactionGroupId?: string) {
            const result = createUndoEntry(id, { type: 'togglePlayback' }, { type: 'togglePlayback' });
            result.id = id;
            result.transactionGroupId = transactionGroupId;
            return result;
        }
        const boundaryGroup = ['group-1', 'group-2', 'group-3'].map((id) => entry(id, 'boundary-group'));
        const pastTail = Array.from({ length: 98 }, (_, index) => entry(`past-${index}`));
        const futureHead = Array.from({ length: 98 }, (_, index) => entry(`future-${index}`));

        undoStore.set({
            past: [entry('past-old'), ...boundaryGroup, ...pastTail],
            future: [...futureHead, ...boundaryGroup, entry('future-old')],
        });
        await flushPersistence();

        const parsed = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        if (!Array.isArray(parsed.past) || !Array.isArray(parsed.future)) {
            throw new TypeError('Expected persisted undo stacks to be arrays');
        }
        expect(parsed.past.map((value) => (isRecord(value) ? value.id : undefined))).toEqual(
            pastTail.map((value) => value.id)
        );
        expect(parsed.future.map((value) => (isRecord(value) ? value.id : undefined))).toEqual(
            futureHead.map((value) => value.id)
        );
    });

    it('persists complete transaction boundary metadata that survives hydration', async () => {
        const { createUndoEntry, undoStore } = await loadSubject();
        const first = createUndoEntry('first', { type: 'togglePlayback' }, { type: 'togglePlayback' });
        first.id = 'group-first';
        first.transactionGroupId = 'complete-group';
        const second = createUndoEntry('second', { type: 'toggleLoop' }, { type: 'toggleLoop' });
        second.id = 'group-second';
        second.transactionGroupId = 'complete-group';

        undoStore.set({ past: [first, second], future: [] });
        await flushPersistence();

        const parsed = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        expect(parsed.past).toEqual([
            expect.objectContaining({
                id: 'group-first',
                transactionGroupIndex: 0,
                transactionGroupSize: 2,
            }),
            expect.objectContaining({
                id: 'group-second',
                transactionGroupIndex: 1,
                transactionGroupSize: 2,
            }),
        ]);

        const reloaded = await loadSubject();
        expect(reloaded.undoStore.value?.past.map((entry) => entry.transactionGroupId)).toEqual([
            'complete-group',
            'complete-group',
        ]);
    });

    it('hydrates only transaction markers proven complete by contiguous boundary metadata', async () => {
        function storedEntry(id: string, transactionGroupId?: string, index?: number, size?: number) {
            return {
                id,
                kind: 'action',
                label: id,
                action: { type: 'togglePlayback' },
                inverseAction: { type: 'togglePlayback' },
                timestamp: 1000,
                source: 'manual',
                transactionGroupId,
                transactionGroupIndex: index,
                transactionGroupSize: size,
            };
        }
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({
                past: [
                    storedEntry('complete-1', 'complete', 0, 2),
                    storedEntry('complete-2', 'complete', 1, 2),
                    storedEntry('partial', 'partial', 0, 2),
                    storedEntry('legacy-unproven', 'legacy-unproven'),
                ],
                future: [],
            })
        );

        const { undoStore } = await loadSubject();

        expect(
            undoStore.value?.past.map((value) => ({ id: value.id, transactionGroupId: value.transactionGroupId }))
        ).toEqual([
            { id: 'complete-1', transactionGroupId: 'complete' },
            { id: 'complete-2', transactionGroupId: 'complete' },
            { id: 'partial', transactionGroupId: undefined },
            { id: 'legacy-unproven', transactionGroupId: undefined },
        ]);
    });

    it('should drop malformed stored undo entries before hydration', async () => {
        const validEntry = {
            id: 'undo-valid',
            kind: 'action',
            label: 'Valid playback',
            action: { type: 'togglePlayback' },
            inverseAction: { type: 'togglePlayback' },
            timestamp: 2000,
            source: 'voice',
        };
        const invalidEntries = [
            {
                id: 'undo-callback',
                kind: 'callback',
                label: 'Callback',
                timestamp: 2001,
                source: 'manual',
                undo: 'not-a-function',
                redo: 'not-a-function',
            },
            {
                id: 'undo-missing-label',
                kind: 'action',
                action: { type: 'stopPlayback' },
                inverseAction: null,
                timestamp: 2002,
                source: 'manual',
            },
            {
                id: 'undo-bad-action',
                kind: 'action',
                label: 'Bad action',
                action: { payload: { bpm: 120 } },
                inverseAction: null,
                timestamp: 2003,
                source: 'manual',
            },
            {
                id: 'undo-bad-inverse',
                kind: 'action',
                label: 'Bad inverse',
                action: { type: 'setTempo', payload: { bpm: 120 } },
                inverseAction: { payload: { bpm: 100 } },
                timestamp: 2004,
                source: 'manual',
            },
            {
                id: 'undo-bad-source',
                kind: 'action',
                label: 'Bad source',
                action: { type: 'stopPlayback' },
                inverseAction: null,
                timestamp: 2005,
                source: 'unknown',
            },
            {
                id: 'undo-bad-group',
                kind: 'action',
                label: 'Bad group',
                action: { type: 'stopPlayback' },
                inverseAction: null,
                timestamp: 2006,
                source: 'manual',
                groupId: 10,
            },
            {
                id: 'undo-dso-snapshot',
                kind: 'action',
                label: 'Corrupted DSO snapshot',
                action: { type: 'restoreDsoSnapshot', payload: { bundle: {} } },
                inverseAction: { type: 'restoreDsoSnapshot', payload: { bundle: {} } },
                timestamp: 2007,
                source: 'ai',
            },
        ];
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({
                past: [validEntry, ...invalidEntries],
                future: invalidEntries,
            })
        );

        const { undoStore } = await loadSubject();

        expect(undoStore.value).toEqual({
            past: [validEntry],
            future: [],
        });
    });

    it('should hydrate empty stacks from invalid stored session shapes', async () => {
        const invalidStoredValues = [
            'not-json',
            JSON.stringify(null),
            JSON.stringify([]),
            JSON.stringify({ past: {}, future: [] }),
            JSON.stringify({ past: [], future: 'bad' }),
        ];

        for (const storedValue of invalidStoredValues) {
            sessionStorage.setItem(UNDO_SESSION_KEY, storedValue);
            const { undoStore } = await loadSubject();
            expect(undoStore.value).toEqual({ past: [], future: [] });
        }
    });
});
