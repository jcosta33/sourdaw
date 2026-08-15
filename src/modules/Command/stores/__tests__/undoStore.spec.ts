import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
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
    const undoStoreModule = await import('../undoStore');
    undoStoreModule.hydrateUndoStoreFromSession(SUPPORTED_SESSION_ACTION_TYPES.map((type) => [type, 1] as const));
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
