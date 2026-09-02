import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
// Large enough to hold a halved mirror, far too small for the whole stack the
// oversized case pushes, so a refusal has to shrink the mirror to land at all.
const MIRROR_QUOTA_BYTES = 4096;
const OVERSIZED_STACK_ENTRY_COUNT = 60;
const SUPPORTED_SESSION_ACTION_TYPES = [
    'replayGeneratedMidi',
    'setMasterGain',
    'setTempo',
    'stopPlayback',
    'toggleMetronome',
    'togglePlayback',
] as const;

async function loadSubject() {
    vi.resetModules();
    const createUndoEntryModule = await import('../../useCases/createUndoEntry');
    const { validateVersionedCommandArguments } = await import('../../useCases/versionedCommandArgumentKeys');
    const undoStoreModule = await import('../undoStore');
    undoStoreModule.hydrateUndoStoreFromSession(
        SUPPORTED_SESSION_ACTION_TYPES.map((actionType) => ({
            actionType,
            operationVersion: 1,
            role: 'forward' as const,
            validateArguments: (payload: unknown) => validateVersionedCommandArguments(actionType, payload),
        }))
    );
    return {
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

function persistedEntryLabels(stack: unknown): string[] {
    if (!Array.isArray(stack)) {
        throw new TypeError('Expected a persisted undo stack to be an array');
    }
    const entries: unknown[] = stack;
    return entries.map((entry) => {
        if (!isRecord(entry) || typeof entry.label !== 'string') {
            throw new TypeError('Expected a persisted undo entry to carry a label');
        }
        return entry.label;
    });
}

/**
 * Storage that refuses only what exceeds its quota, so the write lands exactly
 * when the mirror has shrunk enough to fit.
 */
function stubQuotaLimitedSessionStorage() {
    const originalSetItem = Storage.prototype.setItem;
    return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
        this: Storage,
        key: string,
        value: string
    ): undefined {
        if (key === UNDO_SESSION_KEY && value.length > MIRROR_QUOTA_BYTES) {
            throw new DOMException('quota exceeded', 'QuotaExceededError');
        }
        originalSetItem.call(this, key, value);
        return undefined;
    });
}

describe('undoStore / pushUndo', () => {
    beforeEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    afterEach(async () => {
        await flushPersistence();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('rejects internal replay actions as persisted forward entries', async () => {
        const undoStoreModule = await import('../undoStore');
        const { getInternalUndoSessionReplayContracts } =
            await import('../../useCases/getInternalUndoSessionReplayContracts');
        const restoreAction = {
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: 'clip-midi',
                notes: [],
                expectedNotes: [],
                noteTransformReplayGuard: {
                    trackId: 'track-midi',
                    expectedTrackFrozen: false,
                    expectedClipLocked: false,
                },
            },
        };
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({
                past: [
                    {
                        id: 'internal-forward',
                        kind: 'action',
                        label: 'Internal forward',
                        action: restoreAction,
                        inverseAction: null,
                        timestamp: 1,
                        source: 'ai',
                        actionOperationVersion: 1,
                    },
                ],
                future: [],
            })
        );

        undoStoreModule.hydrateUndoStoreFromSession(getInternalUndoSessionReplayContracts());

        expect(undoStoreModule.undoStore.value).toEqual({ past: [], future: [] });
    });

    it('rejects an internal inverse unless its forward contract validates the whole entry', async () => {
        const undoStoreModule = await import('../undoStore');
        const { getInternalUndoSessionReplayContracts } =
            await import('../../useCases/getInternalUndoSessionReplayContracts');
        const { validateVersionedCommandArguments } = await import('../../useCases/versionedCommandArgumentKeys');
        const restoreAction = {
            type: 'restoreMidiClipNotes',
            payload: {
                clipId: 'clip-midi',
                notes: [],
                expectedNotes: [],
                noteTransformReplayGuard: {
                    trackId: 'track-midi',
                    expectedTrackFrozen: false,
                    expectedClipLocked: false,
                },
            },
        };
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({
                past: [
                    {
                        id: 'unrelated-internal-inverse',
                        kind: 'action',
                        label: 'Unrelated internal inverse',
                        action: { type: 'setTempo', payload: { bpm: 120 } },
                        inverseAction: restoreAction,
                        timestamp: 1,
                        source: 'ai',
                        actionOperationVersion: 1,
                        inverseActionOperationVersion: 1,
                    },
                ],
                future: [],
            })
        );

        undoStoreModule.hydrateUndoStoreFromSession([
            {
                actionType: 'setTempo',
                operationVersion: 1,
                role: 'forward',
                validateArguments: (payload: unknown) => validateVersionedCommandArguments('setTempo', payload),
            },
            ...getInternalUndoSessionReplayContracts(),
        ]);

        expect(undoStoreModule.undoStore.value).toEqual({ past: [], future: [] });
    });

    it('omits a malformed addNotes replay pair from the session mirror before reload', async () => {
        const undoStoreModule = await import('../undoStore');
        const { getExecutableCommandRegistration } = await import('../../useCases/getExecutableCommandRegistration');
        const { getInternalUndoSessionReplayContracts } =
            await import('../../useCases/getInternalUndoSessionReplayContracts');
        const registration = getExecutableCommandRegistration('addNotes');
        undoStoreModule.hydrateUndoStoreFromSession([
            {
                actionType: registration.actionType,
                operationVersion: registration.operationVersion,
                role: 'forward',
                validateArguments: registration.runtimeSchema.validate,
                validateEntry: registration.sessionEntryValidator,
            },
            ...getInternalUndoSessionReplayContracts(),
        ]);
        const baseNotes = [{ id: 'base', pitch: 48, startBeat: 0, duration: 1, velocity: 80 }];
        const duplicateNotes = [
            { id: 'note-duplicate', pitch: 60, startBeat: 1, duration: 1, velocity: 100, probability: 100 },
            { id: 'note-duplicate', pitch: 64, startBeat: 2, duration: 1, velocity: 96, probability: 100 },
        ];
        const expectedNotes = [...baseNotes, ...duplicateNotes];
        undoStoreModule.undoStore.set({
            past: [
                {
                    id: 'undo-malformed-add-notes',
                    kind: 'action',
                    label: 'Add MIDI notes',
                    action: { type: 'addNotes', payload: { clipId: 'clip-midi', notes: duplicateNotes } },
                    inverseAction: {
                        type: 'restoreMidiClipNotes',
                        payload: {
                            clipId: 'clip-midi',
                            notes: baseNotes,
                            expectedNotes,
                            noteTransformReplayGuard: {
                                trackId: 'track-midi',
                                expectedTrackFrozen: false,
                                expectedClipLocked: false,
                            },
                        },
                    },
                    redoAction: {
                        type: 'restoreMidiClipNotes',
                        payload: {
                            clipId: 'clip-midi',
                            notes: expectedNotes,
                            expectedNotes: baseNotes,
                            noteTransformReplayGuard: {
                                trackId: 'track-midi',
                                expectedTrackFrozen: false,
                                expectedClipLocked: false,
                            },
                        },
                    },
                    timestamp: 1,
                    source: 'ai',
                },
            ],
            future: [],
        });

        await flushPersistence();

        const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        expect(persisted.past).toEqual([]);
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
        const redoAction = {
            type: 'replayGeneratedMidi' as const,
            payload: {
                operation: {
                    kind: 'replace-notes' as const,
                    trackId: 'track-1',
                    clip: {
                        id: 'clip-1',
                        trackId: 'track-1',
                        name: 'Lead',
                        startBeat: 0,
                        endBeat: 4,
                        type: 'midi' as const,
                    },
                    expectedNotes: [],
                    replacementNotes: [{ id: 'generated-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                },
            },
        };
        const entry = createUndoEntry(
            'persist',
            { type: 'setMasterGain', payload: { gain: 0.5 } },
            {
                type: 'setMasterGain',
                payload: { gain: 1 },
            },
            'ai',
            redoAction
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
        expect(parsed.past[0]).toMatchObject({
            id: entry.id,
            label: 'persist',
            kind: 'action',
            redoAction,
            actionOperationVersion: 1,
            inverseActionOperationVersion: 1,
            redoActionOperationVersion: 1,
        });

        const reloaded = await loadSubject();
        expect(reloaded.undoStore.value?.past[0]).toMatchObject({
            redoAction,
        });
    });

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
        };
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({
                past: [legacyEntry],
                future: [futureEntry],
            })
        );

        const { undoStore } = await loadSubject();

        expect(undoStore.value).toEqual({
            past: [{ ...legacyEntry, kind: 'action' }],
            future: [futureEntry],
        });
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
                id: 'undo-bad-redo',
                kind: 'action',
                label: 'Bad redo',
                action: { type: 'setTempo', payload: { bpm: 120 } },
                inverseAction: { type: 'setTempo', payload: { bpm: 100 } },
                redoAction: { payload: { bpm: 120 } },
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
                label: 'Retired snapshot action',
                action: { type: 'restoreDsoSnapshot', payload: { bundle: {} } },
                inverseAction: { type: 'restoreDsoSnapshot', payload: { bundle: {} } },
                timestamp: 2007,
                source: 'ai',
            },
            {
                id: 'undo-unknown-retired-action',
                kind: 'action',
                label: 'Unknown retired action',
                action: { type: 'retiredFutureAction', payload: { value: 1 } },
                inverseAction: { type: 'retiredFutureAction', payload: { value: 0 } },
                timestamp: 2008,
                source: 'ai',
            },
            {
                id: 'undo-stale-operation-version',
                kind: 'action',
                label: 'Stale tempo action',
                action: { type: 'setTempo', payload: { bpm: 128 } },
                actionOperationVersion: 2,
                inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
                inverseActionOperationVersion: 2,
                timestamp: 2009,
                source: 'ai',
            },
        ];
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({
                // The valid entry is the newest, because a rejected entry also
                // drops every entry older than it.
                past: [...invalidEntries, validEntry],
                future: invalidEntries,
            })
        );

        const { undoStore } = await loadSubject();

        expect(undoStore.value).toEqual({
            past: [validEntry],
            future: [],
        });
    });

    it('should never serve a mirror left behind by a refused persistence write', async () => {
        const { createUndoEntry, pushUndo } = await loadSubject();
        pushUndo(
            createUndoEntry(
                'first',
                { type: 'setTempo', payload: { bpm: 120 } },
                { type: 'setTempo', payload: { bpm: 110 } }
            )
        );
        await flushPersistence();
        expect(sessionStorage.getItem(UNDO_SESSION_KEY)).not.toBeNull();

        // `setItem` throws before it mutates, so the smaller first write
        // survives in storage while the live stack has moved on.
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string): undefined => {
            if (key === UNDO_SESSION_KEY) {
                throw new DOMException('quota exceeded', 'QuotaExceededError');
            }
            return undefined;
        });
        try {
            pushUndo(
                createUndoEntry(
                    'second',
                    { type: 'setMasterGain', payload: { gain: 0.5 } },
                    { type: 'setMasterGain', payload: { gain: 1 } }
                )
            );
            await flushPersistence();
        } finally {
            setItem.mockRestore();
        }

        const reloaded = await loadSubject();
        expect(reloaded.undoStore.value).toEqual({ past: [], future: [] });
    });

    it('should shrink a refused mirror until it fits and keep the entries nearest the present', async () => {
        const { createUndoEntry, pushUndo } = await loadSubject();
        const setItem = stubQuotaLimitedSessionStorage();
        const pushedLabels = Array.from({ length: OVERSIZED_STACK_ENTRY_COUNT }, (_, index) => `entry-${index}`);
        try {
            for (const label of pushedLabels) {
                pushUndo(
                    createUndoEntry(
                        label,
                        { type: 'setTempo', payload: { bpm: 120 } },
                        { type: 'setTempo', payload: { bpm: 110 } }
                    )
                );
            }
            await flushPersistence();
        } finally {
            setItem.mockRestore();
        }

        const parsed = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const survivingLabels = persistedEntryLabels(parsed.past);
        expect(survivingLabels.length).toBeGreaterThan(0);
        expect(survivingLabels.length).toBeLessThan(pushedLabels.length);
        // Undo pops the tail of `past`, so the entries a shrunken mirror keeps
        // are the newest ones, with the older tail dropped.
        expect(survivingLabels).toEqual(pushedLabels.slice(-survivingLabels.length));
        expect(persistedEntryLabels(parsed.future)).toEqual([]);

        const reloaded = await loadSubject();
        expect(reloaded.undoStore.value?.past.map((entry) => entry.label)).toEqual(survivingLabels);
    });

    it('should keep the nearest redo entries when a refused mirror shrinks a populated future', async () => {
        const { createUndoEntry, undoStore } = await loadSubject();
        const setItem = stubQuotaLimitedSessionStorage();
        const buildStack = (prefix: string) =>
            Array.from({ length: OVERSIZED_STACK_ENTRY_COUNT }, (_, index) =>
                createUndoEntry(
                    `${prefix}-${index}`,
                    { type: 'setTempo', payload: { bpm: 120 } },
                    { type: 'setTempo', payload: { bpm: 110 } }
                )
            );
        // `past` runs oldest first; `future` runs nearest first, the order undo
        // leaves behind when it prepends each entry it undoes.
        const pastEntries = buildStack('edit');
        const futureEntries = buildStack('redo');
        try {
            undoStore.set({ past: pastEntries, future: futureEntries });
            await flushPersistence();
        } finally {
            setItem.mockRestore();
        }

        const parsed = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const survivingRedoLabels = persistedEntryLabels(parsed.future);
        expect(survivingRedoLabels.length).toBeGreaterThan(0);
        expect(survivingRedoLabels.length).toBeLessThan(futureEntries.length);
        // Redo takes the head of `future`, so a shrunken mirror keeps the
        // entries the next session redoes first and drops the far tail.
        expect(survivingRedoLabels).toEqual(
            futureEntries.slice(0, survivingRedoLabels.length).map((entry) => entry.label)
        );

        const survivingPastLabels = persistedEntryLabels(parsed.past);
        expect(survivingPastLabels).toEqual(pastEntries.slice(-survivingPastLabels.length).map((entry) => entry.label));

        const reloadedFromShrunkenMirror = await loadSubject();
        expect(reloadedFromShrunkenMirror.undoStore.value?.future.map((entry) => entry.label)).toEqual(
            survivingRedoLabels
        );
        expect(reloadedFromShrunkenMirror.undoStore.value?.past.map((entry) => entry.label)).toEqual(
            survivingPastLabels
        );
    });

    it('should drop a hydrated entry whose arguments fail the current contract and every entry behind it', async () => {
        const staleArgumentsEntry = {
            id: 'undo-stale-arguments',
            kind: 'action',
            label: 'Stale gain',
            action: { type: 'setMasterGain', payload: { gain: 'loud' } },
            inverseAction: { type: 'setMasterGain', payload: { gain: 1 } },
            timestamp: 3001,
            source: 'manual',
        };
        const reachablePastEntry = {
            id: 'undo-reachable-past',
            kind: 'action',
            label: 'Reachable tempo',
            action: { type: 'setTempo', payload: { bpm: 128 } },
            inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
            timestamp: 3002,
            source: 'manual',
        };
        const olderPastEntry = { ...reachablePastEntry, id: 'undo-older-past', timestamp: 3000 };
        const reachableFutureEntry = { ...reachablePastEntry, id: 'undo-reachable-future', timestamp: 3003 };
        const strandedFutureEntry = { ...reachablePastEntry, id: 'undo-stranded-future', timestamp: 3004 };
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({
                // `past` runs oldest first; `future` runs nearest first.
                past: [olderPastEntry, staleArgumentsEntry, reachablePastEntry],
                future: [reachableFutureEntry, staleArgumentsEntry, strandedFutureEntry],
            })
        );

        const { undoStore } = await loadSubject();

        expect(undoStore.value).toEqual({
            past: [reachablePastEntry],
            future: [reachableFutureEntry],
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
