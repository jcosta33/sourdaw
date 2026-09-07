import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoStore } from '#/modules/Command/stores';
import { commitUndoEntry, createUndoEntry, registerProductionCommandHandlers } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getDrumPreviewBranchHandlers,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { handleDiscardDrawnClip } from '../handleDiscardDrawnClip';
import { handleDiscardDuplicatedClip } from '../handleDiscardDuplicatedClip';
import { handleDrawClip } from '../handleDrawClip';
import { handleDuplicateClipAt } from '../handleDuplicateClipAt';
import { handleMoveClips } from '../handleMoveClips';
import { handleRestoreClipMoves } from '../handleRestoreClipMoves';
import { handleRestoreDrawnClip } from '../handleRestoreDrawnClip';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const TRACK_ID = 'track-keys';

function createClipFixture(id: string, startBeat: number, endBeat: number): Clip {
    return {
        id,
        trackId: TRACK_ID,
        name: `Clip ${id}`,
        startBeat,
        endBeat,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function flushPersistence(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}

function parsePersistedUndoState(raw: string | null): Record<string, unknown> {
    expect(raw).not.toBeNull();
    if (raw === null) {
        throw new Error('Expected undo session state to persist');
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Expected persisted undo state to be an object');
    }
    return parsed as Record<string, unknown>;
}

/** The persisted inverse, byte-identical to what hydration's sanitize validates. */
function persistedInverse(entryIndex = 0): { type: string; payload: Record<string, unknown> } {
    const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
    const persistedPast = persisted.past as { inverseAction: { type: string; payload: Record<string, unknown> } }[];
    return persistedPast[entryIndex]!.inverseAction;
}

const clipOnTrack = (trackId: string, clipId: string): Clip | undefined =>
    trackStore.value?.tracks.find((track) => track.id === trackId)?.clips.find((clip) => clip.id === clipId);

/** The production hydration path: every registered descriptor's forward contract plus the internal-replay contracts. */
function hydrateProductionContracts(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers([
        getArrangementHandlers(),
        getAudioRenderingHandlers(),
        getAutomationHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
        getMidiNoteTransformHandlers(),
        getTransportHandlers(),
    ]);
}

/**
 * Round trips for the slice-three clip actions through the session-undo mirror.
 * Each entry is seeded through the REAL dispatch pair — `describe()` then
 * `execute()` on the registered handler, exactly the two calls the execution
 * kernel makes — so the inverse and redo payloads are what a musician's gesture
 * actually recorded. The mirror must serialize the entry (forward contract +
 * whole-entry validation) and a fresh hydration must restore it with an inverse
 * that still replays against the restored project. Hydration survival is read
 * through the store facade: a label present after `hydrateProductionContracts`
 * proves the entry passed `sanitizeStoredEntry` — contracts and whole-entry
 * validation both ran.
 */
describe('slice-three clip actions / session-undo mirror round trips', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('slice-three session mirror round trips');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        clearHandlerRegistry();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const track = TrackDummy.create({
            id: TRACK_ID,
            name: 'Keys',
            kind: 'midi',
            clips: [createClipFixture('clip-a', 0, 4), createClipFixture('clip-b', 4, 8)],
        });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: true });
        hydrateProductionContracts();
    });

    afterEach(() => {
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        workspaceStore.set({ ...defaultWorkspaceState });
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('drawClip: the recorded entry serializes, rehydrates, and its discard inverse still replays', async () => {
        const action = {
            type: 'drawClip' as const,
            payload: {
                id: 'clip-draw-1',
                trackId: TRACK_ID,
                startBeat: 2,
                endBeat: 4,
                name: 'Clip 2',
                type: 'midi' as const,
                ripple: true,
            },
        };
        const described = handleDrawClip.describe(action);
        void handleDrawClip.execute(action);
        commitUndoEntry(
            createUndoEntry(
                'Draw clip (ripple)',
                action,
                described.inverseAction ?? null,
                'manual',
                described.redoAction
            )
        );
        await flushPersistence();

        // The mirror serialized the whole entry: forward, inverse, and the redo
        // carrying the captured ripple plan, each stamped with its version.
        const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const persistedPast = persisted.past as Record<string, unknown>[];
        expect(persistedPast).toHaveLength(1);
        expect(persistedPast[0]).toMatchObject({
            label: 'Draw clip (ripple)',
            actionOperationVersion: 1,
            inverseActionOperationVersion: 1,
            redoActionOperationVersion: 1,
        });

        // A fresh hydration (the reload path) keeps the entry: a label present
        // after re-hydration proves contracts AND whole-entry validation passed.
        hydrateProductionContracts();
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Draw clip (ripple)']);

        // Its inverse — the exact payload hydration validated — replays against
        // the restored project: the drawn clip goes, the shifted neighbor
        // returns to its origin.
        const inverse = persistedInverse();
        expect(inverse.type).toBe('discardDrawnClip');
        void handleDiscardDrawnClip.execute(inverse as never);
        expect(clipOnTrack(TRACK_ID, 'clip-draw-1')).toBeUndefined();
        expect(clipOnTrack(TRACK_ID, 'clip-b')?.startBeat).toBe(4);
    });

    it('drawClip: a redo rehydrated from the mirror replays the captured plan, not a live re-plan', async () => {
        const action = {
            type: 'drawClip' as const,
            payload: {
                id: 'clip-draw-1',
                trackId: TRACK_ID,
                startBeat: 2,
                endBeat: 4,
                name: 'Clip 2',
                type: 'midi' as const,
                ripple: true,
            },
        };
        const described = handleDrawClip.describe(action);
        void handleDrawClip.execute(action);
        commitUndoEntry(
            createUndoEntry(
                'Draw clip (ripple)',
                action,
                described.inverseAction ?? null,
                'manual',
                described.redoAction
            )
        );
        void handleDiscardDrawnClip.execute(
            described.inverseAction! as Extract<
                import('#/utils/handlerContract').AppAction,
                { type: 'discardDrawnClip' }
            >
        );
        await flushPersistence();

        hydrateProductionContracts();
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Draw clip (ripple)']);

        // The persisted redo carries the captured plan...
        const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const persistedPast = persisted.past as { redoAction: { type: string; payload: Record<string, unknown> } }[];
        expect(persistedPast[0]!.redoAction.type).toBe('restoreDrawnClip');

        // ...and replays it even with ripple editing now OFF, where a live
        // re-plan would find nothing to shift.
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        void handleRestoreDrawnClip.execute(persistedPast[0]!.redoAction as never);
        expect(clipOnTrack(TRACK_ID, 'clip-draw-1')?.startBeat).toBe(2);
        expect(clipOnTrack(TRACK_ID, 'clip-b')?.startBeat).toBe(6);
    });

    it('duplicateClipAt: the recorded entry serializes, rehydrates, and its discard inverse still replays', async () => {
        const action = {
            type: 'duplicateClipAt' as const,
            payload: { clipId: 'clip-a', destinationTrackId: TRACK_ID, startBeat: 8, targetClipId: 'copy-1' },
        };
        const described = handleDuplicateClipAt.describe(action);
        void handleDuplicateClipAt.execute(action);
        commitUndoEntry(createUndoEntry('Duplicate clip at destination', action, described.inverseAction ?? null));
        await flushPersistence();

        const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const persistedPast = persisted.past as Record<string, unknown>[];
        expect(persistedPast).toHaveLength(1);
        expect(persistedPast[0]).toMatchObject({
            label: 'Duplicate clip at destination',
            actionOperationVersion: 1,
            inverseActionOperationVersion: 1,
        });
        expect(clipOnTrack(TRACK_ID, 'copy-1')).toBeDefined();

        hydrateProductionContracts();
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Duplicate clip at destination']);

        const inverse = persistedInverse();
        expect(inverse.type).toBe('discardDuplicatedClip');
        void handleDiscardDuplicatedClip.execute(inverse as never);
        expect(clipOnTrack(TRACK_ID, 'copy-1')).toBeUndefined();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeDefined();
    });

    it('moveClips: the recorded entry serializes with its captured shifts, rehydrates, and its restore inverse still replays', async () => {
        const action = {
            type: 'moveClips' as const,
            payload: {
                moves: [{ clipId: 'clip-a', trackId: TRACK_ID, startBeat: 6 }],
                ripple: true,
            },
        };
        const described = handleMoveClips.describe(action);
        void handleMoveClips.execute(action);
        commitUndoEntry(createUndoEntry('Move clip (ripple)', action, described.inverseAction ?? null));
        await flushPersistence();

        const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const persistedPast = persisted.past as Record<string, unknown>[];
        expect(persistedPast).toHaveLength(1);
        expect(persistedPast[0]).toMatchObject({
            label: 'Move clip (ripple)',
            actionOperationVersion: 1,
            inverseActionOperationVersion: 1,
        });
        // The captured neighbor shifts survived serialization inside the inverse.
        const persistedInverseAction = persistedPast[0]!.inverseAction as {
            payload: { neighborShifts: unknown[] };
        };
        expect(persistedInverseAction.payload.neighborShifts).toEqual([
            { clipId: 'clip-b', origStartBeat: 4, origEndBeat: 8 },
        ]);

        hydrateProductionContracts();
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Move clip (ripple)']);

        const inverse = persistedInverse();
        expect(inverse.type).toBe('restoreClipMoves');
        void handleRestoreClipMoves.execute(inverse as never);
        expect(clipOnTrack(TRACK_ID, 'clip-a')?.startBeat).toBe(0);
        expect(clipOnTrack(TRACK_ID, 'clip-b')?.startBeat).toBe(4);
    });
});
