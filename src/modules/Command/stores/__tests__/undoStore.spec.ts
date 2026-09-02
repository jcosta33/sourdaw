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
    const createCallbackUndoEntryModule = await import('../../useCases/createCallbackUndoEntry');
    const { validateVersionedCommandArguments } = await import('../../useCases/versionedCommandArgumentKeys');
    const undoStoreModule = await import('../undoStore');
    const { clearUndoHistory } = await import('../clearUndoHistory');
    undoStoreModule.hydrateUndoStoreFromSession(
        SUPPORTED_SESSION_ACTION_TYPES.map((actionType) => ({
            actionType,
            operationVersion: 1,
            validateArguments: (payload: unknown) => validateVersionedCommandArguments(actionType, payload),
        }))
    );
    return {
        createUndoEntry: createUndoEntryModule.createUndoEntry,
        createCallbackUndoEntry: createCallbackUndoEntryModule.createCallbackUndoEntry,
        pushUndo: undoStoreModule.pushUndo,
        undoStore: undoStoreModule.undoStore,
        reconcileUndoStoreForProject: undoStoreModule.reconcileUndoStoreForProject,
        clearUndoHistory,
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

describe('undoStore / reconcileUndoStoreForProject (#3331, #3331-repair)', () => {
    beforeEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    afterEach(async () => {
        await flushPersistence();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('round-trips the project identity and document witness the mirror was written against', async () => {
        const { createUndoEntry, pushUndo } = await loadSubject();
        pushUndo(
            createUndoEntry(
                'tagged',
                { type: 'setTempo', payload: { bpm: 120 } },
                { type: 'setTempo', payload: { bpm: 110 } }
            )
        );
        await flushPersistence();

        // No `reconcileUndoStoreForProject` call has happened yet in this
        // session, so the flush persisted no owner — the mirror should carry
        // no `projectId` or `witness` at all.
        const untaggedRaw = sessionStorage.getItem(UNDO_SESSION_KEY);
        expect(untaggedRaw).not.toBeNull();
        const untagged = parsePersistedUndoState(untaggedRaw);
        expect(untagged).not.toHaveProperty('projectId');
        expect(untagged).not.toHaveProperty('witness');

        const { reconcileUndoStoreForProject, pushUndo: pushUndoAgain } = await loadSubject();
        // Reconciling against the project this session's mirror was untagged
        // for is a mismatch (no recorded owner), so the hydrated entry above is
        // dropped and the live stacks start tagged to 'project-a' from here on.
        reconcileUndoStoreForProject('project-a', () => 'witness-a');
        pushUndoAgain(
            createUndoEntry(
                'project-a-edit',
                { type: 'setTempo', payload: { bpm: 130 } },
                { type: 'setTempo', payload: { bpm: 120 } }
            )
        );
        await flushPersistence();

        const taggedRaw = sessionStorage.getItem(UNDO_SESSION_KEY);
        const parsed = parsePersistedUndoState(taggedRaw);
        expect(parsed.projectId).toBe('project-a');
        expect(parsed.witness).toBe('witness-a');
        expect(persistedEntryLabels(parsed.past)).toEqual(['project-a-edit']);

        // Hydrating a fresh session from that tagged mirror recovers the
        // stacks, and reconciling against the same identity keeps them.
        const reloaded = await loadSubject();
        expect(reloaded.undoStore.value?.past.map((entry) => entry.label)).toEqual(['project-a-edit']);
        reloaded.reconcileUndoStoreForProject('project-a', () => 'witness-a');
        expect(reloaded.undoStore.value?.past.map((entry) => entry.label)).toEqual(['project-a-edit']);
    });

    it('clears stacks hydrated from a mirror with no recorded identity', async () => {
        const untaggedEntry = {
            id: 'undo-untagged',
            kind: 'action',
            label: 'Untagged edit',
            action: { type: 'setTempo', payload: { bpm: 128 } },
            inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
            timestamp: 4000,
            source: 'manual',
        };
        // Backward-compatible shape: a mirror written before identity tagging
        // existed carries no `projectId` or `witness` key at all.
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify({ past: [untaggedEntry], future: [] }));

        const { undoStore, reconcileUndoStoreForProject } = await loadSubject();
        // Hydration itself still loads whatever entries validate; identity only
        // gates what the boot-restore reconciliation keeps.
        expect(undoStore.value?.past).toEqual([untaggedEntry]);

        reconcileUndoStoreForProject('any-project', () => 'any-witness');

        expect(undoStore.value).toEqual({ past: [], future: [] });
    });

    it('keeps hydrated stacks when both the reconciled project id and document witness match the mirrored identity', async () => {
        const matchingEntry = {
            id: 'undo-matching',
            kind: 'action',
            label: 'Matching edit',
            action: { type: 'setTempo', payload: { bpm: 128 } },
            inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
            timestamp: 5000,
            source: 'manual',
        };
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({ past: [matchingEntry], future: [], projectId: 'project-b', witness: 'witness-b' })
        );

        const { undoStore, reconcileUndoStoreForProject } = await loadSubject();
        expect(undoStore.value?.past).toEqual([matchingEntry]);

        reconcileUndoStoreForProject('project-b', () => 'witness-b');

        expect(undoStore.value?.past).toEqual([matchingEntry]);
    });

    it('clears hydrated stacks when the document witness differs even though the project id matches', async () => {
        const staleDocumentEntry = {
            id: 'undo-stale-document',
            kind: 'action',
            label: 'Stale document edit',
            action: { type: 'setTempo', payload: { bpm: 128 } },
            inverseAction: { type: 'setTempo', payload: { bpm: 120 } },
            timestamp: 6000,
            source: 'manual',
        };
        sessionStorage.setItem(
            UNDO_SESSION_KEY,
            JSON.stringify({
                past: [staleDocumentEntry],
                future: [],
                projectId: 'project-c',
                witness: 'witness-old',
            })
        );

        const { undoStore, reconcileUndoStoreForProject } = await loadSubject();
        expect(undoStore.value?.past).toEqual([staleDocumentEntry]);

        // Same project id as the mirror, but the reloaded document no longer
        // matches — a stale restore, or edits the mirror never captured.
        reconcileUndoStoreForProject('project-c', () => 'witness-new');

        expect(undoStore.value).toEqual({ past: [], future: [] });
    });

    it('clears the mirror owner on clearUndoHistory so the next flush, and the next reconcile, both treat the stacks as untagged', async () => {
        const { reconcileUndoStoreForProject, pushUndo, undoStore, clearUndoHistory, createUndoEntry } =
            await loadSubject();
        reconcileUndoStoreForProject('project-d', () => 'witness-d');
        pushUndo(
            createUndoEntry(
                'd-edit',
                { type: 'setTempo', payload: { bpm: 128 } },
                { type: 'setTempo', payload: { bpm: 120 } }
            )
        );
        await flushPersistence();

        const taggedRaw = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        expect(taggedRaw.projectId).toBe('project-d');
        expect(taggedRaw.witness).toBe('witness-d');

        // An in-session project transition (new project, template,
        // arrangement switch, branch switch) calls this: it drops the owner
        // alongside the stacks, per `Command/AGENTS.md`.
        clearUndoHistory();
        expect(undoStore.value).toEqual({ past: [], future: [] });
        await flushPersistence();

        const untaggedRaw = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        expect(untaggedRaw).not.toHaveProperty('projectId');
        expect(untaggedRaw).not.toHaveProperty('witness');

        // A fresh hydration from this untagged mirror, reconciled for the same
        // project id and witness, still mismatches (no recorded owner) and
        // clears again.
        const reloaded = await loadSubject();
        reloaded.reconcileUndoStoreForProject('project-d', () => 'witness-d');
        expect(reloaded.undoStore.value).toEqual({ past: [], future: [] });
    });
});

describe('undoStore / session mirror write truncates at the first unserializable entry (#3331-repair-2, E2)', () => {
    beforeEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    afterEach(async () => {
        await flushPersistence();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('drops a callback entry and everything behind it from the persisted past, instead of splicing an invisible hole', async () => {
        const { createUndoEntry, createCallbackUndoEntry, undoStore } = await loadSubject();
        // Oldest first: a move, then a callback-only slip (drags/slips/splits/
        // imports have no serializable inverse), then a mute nearest the
        // present. The buggy `flatMap` would splice the slip out and persist
        // `[move, mute]` as if they were adjacent — corrupting undo order,
        // because a later undo would invert `mute` and then `move`, silently
        // skipping the slip it never mirrored. The fix stops at the slip and
        // keeps only the unbroken run nearest the present.
        const move = createUndoEntry(
            'move',
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'setTempo', payload: { bpm: 110 } }
        );
        const slip = createCallbackUndoEntry({ label: 'slip', undo: () => undefined, redo: () => undefined });
        const mute = createUndoEntry(
            'mute',
            { type: 'setMasterGain', payload: { gain: 0 } },
            { type: 'setMasterGain', payload: { gain: 1 } }
        );
        undoStore.set({ past: [move, slip, mute], future: [] });
        await flushPersistence();

        const parsed = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        expect(persistedEntryLabels(parsed.past)).toEqual(['mute']);

        // Live in-memory stacks are untouched by the mirror write: only the
        // persisted, next-boot-visible copy truncates.
        expect(undoStore.value?.past).toEqual([move, slip, mute]);
    });

    it('drops a callback entry and everything behind it from the persisted future', async () => {
        const { createUndoEntry, createCallbackUndoEntry, undoStore } = await loadSubject();
        // Nearest first: a redoable tempo change is reachable, then a
        // callback-only redo, then a further redoable gain change that the
        // callback strands.
        const redoNearest = createUndoEntry(
            'redo-nearest',
            { type: 'setTempo', payload: { bpm: 130 } },
            { type: 'setTempo', payload: { bpm: 120 } }
        );
        const redoCallback = createCallbackUndoEntry({
            label: 'redo-callback',
            undo: () => undefined,
            redo: () => undefined,
        });
        const redoStranded = createUndoEntry(
            'redo-stranded',
            { type: 'setMasterGain', payload: { gain: 0.8 } },
            { type: 'setMasterGain', payload: { gain: 0.5 } }
        );
        undoStore.set({ past: [], future: [redoNearest, redoCallback, redoStranded] });
        await flushPersistence();

        const parsed = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        expect(persistedEntryLabels(parsed.future)).toEqual(['redo-nearest']);
        expect(undoStore.value?.future).toEqual([redoNearest, redoCallback, redoStranded]);
    });
});
