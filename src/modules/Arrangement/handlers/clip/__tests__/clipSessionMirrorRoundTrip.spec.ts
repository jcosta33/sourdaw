import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore, type AutomationLane } from '#/modules/Automation/stores';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoStore } from '#/modules/Command/stores';
import {
    commitUndoEntry,
    createUndoEntry,
    executeAppAction,
    registerProductionCommandHandlers,
    undo,
    redo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { gainEnvelopeStore, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { setWarpState, warpStateStore } from '../../../stores/warpStates';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { handleDiscardDrawnClip } from '../handleDiscardDrawnClip';
import { handleDiscardDuplicatedClip } from '../handleDiscardDuplicatedClip';
import { handleDrawClip } from '../handleDrawClip';
import { handleDuplicateClipAt } from '../handleDuplicateClipAt';
import { handleMoveClips } from '../handleMoveClips';
import { handleRestoreClipMoves } from '../handleRestoreClipMoves';
import { handleRestoreDrawnClip } from '../handleRestoreDrawnClip';
import { isMoveClipSessionEntry } from '../validateClipEditSessionEntries';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const TRACK_ID = 'track-keys';

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

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

function seedAudioMoveSource(canonicalSeconds?: number): void {
    tempoMapStore.set({
        changes: [
            { id: 'initial', beat: 0, tempo: 120, curve: 'instant' },
            { id: 'slower', beat: 4, tempo: 60, curve: 'instant' },
        ],
    });
    const before = trackStore.value!;
    const original: Clip = {
        ...before.tracks[0]!.clips[0]!,
        type: 'audio',
        audioBufferId: 'buffer-a',
        audioOffsetBeats: canonicalSeconds === undefined ? 2 : 9,
    };
    if (canonicalSeconds !== undefined) {
        original.audioOffsetSeconds = canonicalSeconds;
    }
    trackStore.set({
        ...before,
        tracks: [{ ...before.tracks[0]!, kind: 'audio', clips: [original, before.tracks[0]!.clips[1]!] }],
    });
    takeLaneStore.set({
        lanes: [
            {
                id: 'lane-a',
                trackId: TRACK_ID,
                activeCompRegions: [],
                takes: [0, 2].map((sourceOffsetBeats, index) => ({
                    id: `take-${index}`,
                    clipId: 'clip-a',
                    name: `Take ${index}`,
                    startBeat: 0,
                    endBeat: 4,
                    selected: false,
                    sourceOffsetBeats,
                })),
            },
        ],
    });
}

function automationLane(id: string, clipId?: string): AutomationLane {
    const lane: AutomationLane = {
        id,
        trackId: TRACK_ID,
        parameterId: `parameter-${id}`,
        parameterName: id,
        points: [{ beat: 0.5, value: 0.25, curve: 'linear', tension: 0 }],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
    if (clipId !== undefined) {
        lane.clipId = clipId;
    }
    return lane;
}

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
        getYeastHandlers(),
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
        setNotificationEventBus(createEventBus<NotificationEvents>());
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('slice-three session mirror round trips');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        clearHandlerRegistry();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        const track = TrackDummy.create({
            id: TRACK_ID,
            name: 'Keys',
            kind: 'midi',
            clips: [createClipFixture('clip-a', 0, 4), createClipFixture('clip-b', 4, 8)],
        });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: true });
        hydrateProductionContracts();
    });

    afterEach(() => {
        clearHandlerRegistry();
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        automationStore.set({ lanes: [] });
        workspaceStore.set({ ...defaultWorkspaceState });
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it.each([
        {
            name: 'gain envelope point',
            corrupt: (satellite: {
                gainEnvelope: { points: { gainDb: unknown }[] };
                warpState: { markers: { originalBeat: unknown }[] };
            }) => {
                satellite.gainEnvelope.points[0]!.gainDb = 'bad';
            },
        },
        {
            name: 'warp marker',
            corrupt: (satellite: {
                gainEnvelope: { points: { gainDb: unknown }[] };
                warpState: { markers: { originalBeat: unknown }[] };
            }) => {
                satellite.warpState.markers[0]!.originalBeat = 'bad';
            },
        },
    ])('rejects a malformed persisted removeClip $name before real undo writes', async ({ corrupt }) => {
        setEnvelope('clip-a', {
            clipId: 'clip-a',
            enabled: true,
            points: [{ id: 'envelope-point-a', beatOffset: 0, gainDb: -6 }],
        });
        setWarpState('clip-a', {
            enabled: true,
            markers: [{ id: 'warp-marker-a', originalBeat: 0, warpedBeat: 0.5 }],
            stretchMode: 'repitch',
            originalTempo: 120,
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );

        const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const entries = persisted.past as {
            inverseAction: {
                payload: {
                    ripplePlan: {
                        clipSatellites: {
                            gainEnvelope: { points: { gainDb: unknown }[] };
                            warpState: { markers: { originalBeat: unknown }[] };
                        }[];
                    };
                };
            };
        }[];
        const satellite = entries[0]!.inverseAction.payload.ripplePlan.clipSatellites[0]!;
        expect(satellite.gainEnvelope.points[0]?.gainDb).toBe(-6);
        expect(satellite.warpState.markers[0]?.originalBeat).toBe(0);
        corrupt(satellite);
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(persisted));

        const beforeRaw = structuredClone(getCrdtDoc('root'));
        const beforeGainProjection = structuredClone(gainEnvelopeStore.value);
        const beforeWarpProjection = structuredClone(warpStateStore.value);
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(0);
        await undo();
        expect(getCrdtDoc('root')).toEqual(beforeRaw);
        expect(gainEnvelopeStore.value).toEqual(beforeGainProjection);
        expect(warpStateStore.value).toEqual(beforeWarpProjection);
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
    });

    it('restores real gain and warp captures after removal, persistence, and fresh hydration', async () => {
        const envelope = {
            clipId: 'clip-a',
            enabled: true,
            points: [{ id: 'envelope-point-a', beatOffset: 0, gainDb: -6 }],
        };
        const warpState = {
            enabled: true,
            markers: [{ id: 'warp-marker-a', originalBeat: 0, warpedBeat: 0.5 }],
            stretchMode: 'repitch' as const,
            originalTempo: 120,
        };
        setEnvelope('clip-a', envelope);
        setWarpState('clip-a', warpState);
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        expect(gainEnvelopeStore.value?.envelopes['clip-a']).toBeUndefined();
        expect(warpStateStore.value?.states['clip-a']).toBeUndefined();

        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeDefined();
        expect(gainEnvelopeStore.value?.envelopes['clip-a']).toEqual(envelope);
        expect(warpStateStore.value?.states['clip-a']).toEqual(warpState);
        expect(
            getCrdtDoc<{
                gainEnvelopes: { envelopes: Record<string, unknown> };
                warpStates: { states: Record<string, unknown> };
            }>('root')
        ).toMatchObject({
            gainEnvelopes: { envelopes: { 'clip-a': envelope } },
            warpStates: { states: { 'clip-a': warpState } },
        });

        await redo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
        expect(gainEnvelopeStore.value?.envelopes['clip-a']).toBeUndefined();
        expect(warpStateStore.value?.states['clip-a']).toBeUndefined();
        expect(
            getCrdtDoc<{
                gainEnvelopes: { envelopes: Record<string, unknown> };
                warpStates: { states: Record<string, unknown> };
            }>('root')
        ).toMatchObject({ gainEnvelopes: { envelopes: {} }, warpStates: { states: {} } });
    });

    it('restores every removed clip automation lane from real persisted capture through Undo and Redo', async () => {
        const removedLanes = [automationLane('clip-lane-a', 'clip-a'), automationLane('clip-lane-b', 'clip-a')];
        removedLanes[1]!.points[0]!.value = 0.75;
        const unrelatedLane = automationLane('unrelated-lane');
        automationStore.set({ lanes: [...removedLanes, unrelatedLane] });
        setEnvelope('clip-a', {
            clipId: 'clip-a',
            enabled: true,
            points: [{ id: 'gain-a', beatOffset: 0, gainDb: -6 }],
        });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: { 'clip-a': [{ id: 'note-a', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushAutomergeStorageWrites();

        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        expect(persistedInverse().payload.ripplePlan).toMatchObject({ clipAutomationLanes: removedLanes });
        const shiftedUnrelatedLane = structuredClone(automationStore.value?.lanes[0]);
        expect(automationStore.value?.lanes).toEqual([shiftedUnrelatedLane]);
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeDefined();
        expect(automationStore.value?.lanes).toEqual([unrelatedLane, ...removedLanes]);
        expect(getCrdtDoc<{ automation: { lanes: AutomationLane[] } }>('root')?.automation.lanes).toEqual([
            unrelatedLane,
            ...removedLanes,
        ]);
        expect(midiStore.value?.notesByClipId['clip-a']).toHaveLength(1);
        expect(gainEnvelopeStore.value?.envelopes['clip-a']?.points[0]?.gainDb).toBe(-6);
        expect(undoStore.value?.future).toHaveLength(1);

        await redo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
        expect(automationStore.value?.lanes).toEqual([shiftedUnrelatedLane]);
        expect(getCrdtDoc<{ automation: { lanes: AutomationLane[] } }>('root')?.automation.lanes).toEqual([
            shiftedUnrelatedLane,
        ]);
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it.each([
        {
            name: 'point value',
            corrupt: (lane: Record<string, unknown>) => {
                (lane.points as { value: unknown }[])[0]!.value = 'bad';
            },
        },
        {
            name: 'point curve',
            corrupt: (lane: Record<string, unknown>) => {
                (lane.points as { curve: unknown }[])[0]!.curve = 'bad';
            },
        },
    ])(
        'rejects a persisted removeClip with malformed automation $name before real Undo writes',
        async ({ corrupt }) => {
            const removedLanes = [automationLane('clip-lane-a', 'clip-a'), automationLane('clip-lane-b', 'clip-a')];
            const unrelatedLane = automationLane('unrelated-lane');
            automationStore.set({ lanes: [...removedLanes, unrelatedLane] });
            setEnvelope('clip-a', {
                clipId: 'clip-a',
                enabled: true,
                points: [{ id: 'gain-a', beatOffset: 0, gainDb: -6 }],
            });
            midiStore.set({
                probabilitySeed: 1,
                notesByClipId: { 'clip-a': [{ id: 'note-a', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }] },
                ccByClipId: {},
                pitchBendByClipId: {},
            });
            flushAutomergeStorageWrites();

            await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
            await vi.waitFor(() =>
                expect(
                    (parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length
                ).toBe(1)
            );
            const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            const entries = persisted.past as {
                inverseAction: { payload: { ripplePlan: { clipAutomationLanes: Record<string, unknown>[] } } };
            }[];
            expect(entries[0]!.inverseAction.payload.ripplePlan.clipAutomationLanes).toHaveLength(2);
            corrupt(entries[0]!.inverseAction.payload.ripplePlan.clipAutomationLanes[0]!);
            sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(persisted));

            const beforeRaw = structuredClone(getCrdtDoc('root'));
            const beforeTrack = structuredClone(trackStore.value);
            const beforeMidi = structuredClone(midiStore.value);
            const beforeGain = structuredClone(gainEnvelopeStore.value);
            const beforeAutomation = structuredClone(automationStore.value);
            hydrateProductionContracts();
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(0);
            await undo();
            expect(getCrdtDoc('root')).toEqual(beforeRaw);
            expect(trackStore.value).toEqual(beforeTrack);
            expect(midiStore.value).toEqual(beforeMidi);
            expect(gainEnvelopeStore.value).toEqual(beforeGain);
            expect(automationStore.value).toEqual(beforeAutomation);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(0);
        }
    );

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

    it.each([
        {
            name: 'splitClip',
            action: { type: 'splitClip' as const, payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' } },
            inverse: 'restoreClipSplitState',
        },
        {
            name: 'moveClip',
            action: { type: 'moveClip' as const, payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 9 } },
            inverse: 'restoreClipPlacement',
        },
        {
            name: 'removeClip',
            action: { type: 'removeClip' as const, payload: { clipId: 'clip-a' } },
            inverse: 'restoreClip',
        },
    ])('$name: production action survives session hydration and real undo/redo', async ({ action, inverse }) => {
        await executeAppAction(action, { source: 'manual' });
        const afterAction = structuredClone(trackStore.value);
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const past = persisted.past as { inverseAction: { type: string } }[];
        expect(past).toHaveLength(1);
        expect(past[0]?.inverseAction.type).toBe(inverse);

        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ startBeat: 0, endBeat: 4 });
        await redo();
        expect(undoStore.value?.past).toHaveLength(1);
        expect(trackStore.value).toEqual(afterAction);
        const projectClips = getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root')?.tracks.tracks[0]?.clips;
        expect(projectClips?.map((clip) => [clip.id, clip.startBeat, clip.endBeat])).toEqual(
            trackStore.value?.tracks[0]?.clips.map((clip) => [clip.id, clip.startBeat, clip.endBeat])
        );
    });

    it.each([
        {
            name: 'splitClip',
            action: { type: 'splitClip' as const, payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' } },
            corrupt: (entry: unknown) => {
                (entry as { inverseAction: { payload: { rightClipId: string } } }).inverseAction.payload.rightClipId =
                    'other-right';
            },
        },
        {
            name: 'moveClip',
            action: { type: 'moveClip' as const, payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 9 } },
            corrupt: (entry: unknown) => {
                (
                    entry as { redoAction: { payload: { replacement: { startBeat: number } } } }
                ).redoAction.payload.replacement.startBeat = 11;
            },
        },
        {
            name: 'removeClip',
            action: { type: 'removeClip' as const, payload: { clipId: 'clip-a' } },
            corrupt: (entry: unknown) => {
                (
                    entry as { inverseAction: { payload: { clipSnapshot: { id: string } } } }
                ).inverseAction.payload.clipSnapshot.id = 'other-clip';
            },
        },
        {
            name: 'moveClip nonfinite placement',
            action: { type: 'moveClip' as const, payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 9 } },
            corrupt: (entry: unknown) => {
                (
                    entry as { inverseAction: { payload: { expected: { startBeat: number } } } }
                ).inverseAction.payload.expected.startBeat = Number.POSITIVE_INFINITY;
            },
        },
        {
            name: 'removeClip malformed snapshot',
            action: { type: 'removeClip' as const, payload: { clipId: 'clip-a' } },
            corrupt: (entry: unknown) => {
                const payload = (
                    entry as {
                        inverseAction: {
                            payload: {
                                clipSnapshot: { type: string };
                                ripplePlan: { removedClips: { type: string }[] };
                            };
                        };
                    }
                ).inverseAction.payload;
                payload.clipSnapshot.type = 'other';
                payload.ripplePlan.removedClips[0]!.type = 'other';
            },
        },
    ])(
        '$name: forged replay relationship is dropped on hydration without project writes',
        async ({ action, corrupt }) => {
            await executeAppAction(action, { source: 'manual' });
            await vi.waitFor(() =>
                expect(
                    (parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length
                ).toBe(1)
            );
            const projectBefore = structuredClone(trackStore.value);
            const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            const past = persisted.past as unknown[];
            corrupt(past[0]);
            sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(persisted));
            hydrateProductionContracts();
            expect(undoStore.value?.past).toEqual([]);
            expect(trackStore.value).toEqual(projectBefore);
        }
    );

    it('fractional move retains exact captured geometry through hydration, undo, and redo', async () => {
        await executeAppAction(
            { type: 'moveClip', payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 0.1 } },
            { source: 'manual' }
        );
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ startBeat: 0.1, endBeat: 4.1 });
        expect(undoStore.value?.past).toHaveLength(1);
        await vi.waitFor(() => expect(sessionStorage.getItem(UNDO_SESSION_KEY)).not.toBeNull());
        expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1);
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ startBeat: 0, endBeat: 4 });
        expect(
            getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root')?.tracks.tracks[0]?.clips.find(
                (clip) => clip.id === 'clip-a'
            )
        ).toMatchObject({ startBeat: 0, endBeat: 4 });
        await redo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ startBeat: 0.1, endBeat: 4.1 });
        expect(
            getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root')?.tracks.tracks[0]?.clips.find(
                (clip) => clip.id === 'clip-a'
            )
        ).toMatchObject({ startBeat: 0.1, endBeat: 4.1 });
    });

    it('hydrates a saved canonical-zero audio removal and restores the exact source field', async () => {
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        const before = trackStore.value!;
        const original: Clip = {
            ...before.tracks[0]!.clips[0]!,
            type: 'audio',
            audioBufferId: 'buffer-a',
            audioOffsetSeconds: 0,
            audioOffsetBeats: 9,
        };
        trackStore.set({
            ...before,
            tracks: [{ ...before.tracks[0]!, kind: 'audio', clips: [original, before.tracks[0]!.clips[1]!] }],
        });
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toEqual(original);
        const raw = getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root');
        expect(raw?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-a')).toEqual(original);
        await redo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
    });

    it.each(['audioSource', 'takeSources'] as const)(
        'drops a saved move with coherently corrupted %s before project writes',
        async (field) => {
            seedAudioMoveSource(0);
            await executeAppAction(
                { type: 'moveClip', payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 5.5 } },
                { source: 'manual' }
            );
            await vi.waitFor(() =>
                expect(
                    (parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length
                ).toBe(1)
            );
            const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            const entry = (persisted.past as Record<string, unknown>[])[0]!;
            const inverse = (entry.inverseAction as { payload: { expected: Record<string, unknown> } }).payload;
            const redo = (entry.redoAction as { payload: { replacement: Record<string, unknown> } }).payload;
            if (field === 'audioSource') {
                (inverse.expected.audioSource as Record<string, unknown>).audioOffsetSeconds = 'invalid';
                (redo.replacement.audioSource as Record<string, unknown>).audioOffsetSeconds = 'invalid';
            } else {
                (inverse.expected.takeSources as Record<string, unknown>[])[1]!.sourceOffsetSeconds = 'invalid';
                (redo.replacement.takeSources as Record<string, unknown>[])[1]!.sourceOffsetSeconds = 'invalid';
            }
            sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(persisted));
            const rawBefore = structuredClone(getCrdtDoc('root'));
            const trackBefore = structuredClone(trackStore.value);
            const takesBefore = structuredClone(takeLaneStore.value);
            hydrateProductionContracts();
            expect(undoStore.value?.past).toHaveLength(0);
            await undo();
            expect(getCrdtDoc('root')).toEqual(rawBefore);
            expect(trackStore.value).toEqual(trackBefore);
            expect(takeLaneStore.value).toEqual(takesBefore);
        }
    );

    it.each([true, false])(
        'hydrates a fractional audio move and restores source presence with canonical=%s',
        async (canonical) => {
            seedAudioMoveSource(canonical ? 0 : undefined);
            const original = structuredClone(clipOnTrack(TRACK_ID, 'clip-a'));
            const originalTakes = structuredClone(takeLaneStore.value?.lanes);
            await executeAppAction(
                { type: 'moveClip', payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 5.5 } },
                { source: 'manual' }
            );
            expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({
                startBeat: 5.5,
                audioOffsetSeconds: canonical ? 0 : 1,
                audioOffsetBeats: canonical ? 0 : 1,
            });
            expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.sourceOffsetSeconds)).toEqual([0, 1]);
            await vi.waitFor(() =>
                expect(
                    (parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length
                ).toBe(1)
            );
            const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            const entry = (persisted.past as Record<string, unknown>[])[0]!;
            const inverse = (entry.inverseAction as { payload: { expected: Record<string, unknown> } }).payload;
            expect(inverse.expected.audioSource).toEqual({
                audioOffsetSeconds: canonical ? 0 : 1,
                audioOffsetBeats: canonical ? 0 : 1,
            });
            expect(
                (inverse.expected.takeSources as { sourceOffsetSeconds: number }[]).map(
                    (take) => take.sourceOffsetSeconds
                )
            ).toEqual([0, 1]);
            expect(isMoveClipSessionEntry(entry as HandlerSessionActionEntry)).toBe(true);

            hydrateProductionContracts();
            expect(undoStore.value?.past).toHaveLength(1);
            await undo();
            expect(clipOnTrack(TRACK_ID, 'clip-a')).toEqual(original);
            expect(takeLaneStore.value?.lanes).toEqual(originalTakes);
            const rawUndo = getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] }; takeLanes: { lanes: unknown[] } }>(
                'root'
            );
            expect(rawUndo?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-a')).toEqual(original);
            expect(rawUndo?.takeLanes.lanes).toEqual(originalTakes);
            const rawClip = rawUndo?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-a');
            if (canonical) {
                expect(rawClip?.audioOffsetSeconds).toBe(0);
            } else {
                expect(Object.hasOwn(rawClip ?? {}, 'audioOffsetSeconds')).toBe(false);
            }
            expect(undoStore.value?.future).toHaveLength(1);
            await redo();
            expect(clipOnTrack(TRACK_ID, 'clip-a')?.audioOffsetSeconds).toBe(canonical ? 0 : 1);
            expect(takeLaneStore.value?.lanes[0]?.takes.map((take) => take.sourceOffsetSeconds)).toEqual([0, 1]);
            expect(undoStore.value?.past).toHaveLength(1);
        }
    );

    it.each(['clip', 'take'] as const)(
        'keeps a peer %s source edit and saved Redo after hydrated Undo',
        async (field) => {
            seedAudioMoveSource(0);
            await executeAppAction(
                { type: 'moveClip', payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 5.5 } },
                { source: 'manual' }
            );
            await vi.waitFor(() =>
                expect(
                    (parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length
                ).toBe(1)
            );
            hydrateProductionContracts();
            expect(undoStore.value?.past).toHaveLength(1);
            await undo();
            expect(undoStore.value?.future).toHaveLength(1);
            if (field === 'clip') {
                const before = trackStore.value!;
                trackStore.set({
                    ...before,
                    tracks: before.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) =>
                            clip.id === 'clip-a' ? { ...clip, audioOffsetSeconds: 7 } : clip
                        ),
                    })),
                });
            } else {
                const before = takeLaneStore.value!;
                takeLaneStore.set({
                    lanes: before.lanes.map((lane) => ({
                        ...lane,
                        takes: lane.takes.map((take) =>
                            take.id === 'take-1' ? { ...take, sourceOffsetSeconds: 7 } : take
                        ),
                    })),
                });
            }
            const rawPeer = structuredClone(getCrdtDoc('root'));
            const trackPeer = structuredClone(trackStore.value);
            const takesPeer = structuredClone(takeLaneStore.value);
            const historyPeer = structuredClone(undoStore.value);
            await redo();
            expect(getCrdtDoc('root')).toEqual(rawPeer);
            expect(trackStore.value).toEqual(trackPeer);
            expect(takeLaneStore.value).toEqual(takesPeer);
            expect(undoStore.value).toEqual(historyPeer);
        }
    );

    it.each([
        {
            name: 'trim',
            peerSource: 'changed',
            action: { type: 'trimClipStart' as const, payload: { clipId: 'clip-a', newStartBeat: 2 } },
        },
        {
            name: 'trim',
            peerSource: 'absent',
            action: { type: 'trimClipStart' as const, payload: { clipId: 'clip-a', newStartBeat: 2 } },
        },
        {
            name: 'slip',
            peerSource: 'changed',
            action: {
                type: 'slipClipContent' as const,
                payload: { clipId: 'clip-a', clipType: 'audio' as const, offset: 2, offsetSeconds: 1 },
            },
        },
        {
            name: 'slip',
            peerSource: 'absent',
            action: {
                type: 'slipClipContent' as const,
                payload: { clipId: 'clip-a', clipType: 'audio' as const, offset: 2, offsetSeconds: 1 },
            },
        },
    ])(
        'keeps a peer $peerSource source edit and saved $name Redo after hydrated Undo',
        async ({ action, peerSource }) => {
            seedAudioMoveSource(0);
            takeLaneStore.set({ lanes: [] });
            await executeAppAction(action, { source: 'manual' });
            await vi.waitFor(() =>
                expect(
                    (parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length
                ).toBe(1)
            );
            hydrateProductionContracts();
            expect(undoStore.value?.past).toHaveLength(1);
            await undo();
            expect(clipOnTrack(TRACK_ID, 'clip-a')?.audioOffsetSeconds).toBe(0);
            expect(undoStore.value?.future).toHaveLength(1);
            const before = trackStore.value!;
            trackStore.set({
                ...before,
                tracks: before.tracks.map((track) => ({
                    ...track,
                    clips: track.clips.map((clip) => {
                        if (clip.id !== 'clip-a') {
                            return clip;
                        }
                        const edited = { ...clip };
                        if (peerSource === 'absent') {
                            delete edited.audioOffsetSeconds;
                        } else {
                            edited.audioOffsetSeconds = 7;
                        }
                        return edited;
                    }),
                })),
            });
            const rawPeer = structuredClone(getCrdtDoc('root'));
            const trackPeer = structuredClone(trackStore.value);
            const historyPeer = structuredClone(undoStore.value);
            await redo();
            expect(getCrdtDoc('root')).toEqual(rawPeer);
            expect(trackStore.value).toEqual(trackPeer);
            expect(undoStore.value).toEqual(historyPeer);
        }
    );

    it.each([
        { name: 'trim canonical zero', canonical: 0, action: 'trim', nextSeconds: 3, nextBeats: 3 },
        { name: 'trim signed preroll', canonical: -2, action: 'trim', nextSeconds: 1, nextBeats: 1 },
        { name: 'trim legacy absence', canonical: undefined, action: 'trim', nextSeconds: 4, nextBeats: 4 },
        { name: 'slip canonical zero', canonical: 0, action: 'slip', nextSeconds: -2, nextBeats: -4 },
        { name: 'slip signed preroll', canonical: -2, action: 'slip', nextSeconds: -2, nextBeats: -4 },
        { name: 'slip legacy absence', canonical: undefined, action: 'slip', nextSeconds: -2, nextBeats: -4 },
    ] as const)('$name preserves exact source fields through saved Undo and Redo', async (scenario) => {
        seedAudioMoveSource(scenario.canonical);
        takeLaneStore.set({ lanes: [] });
        const before = trackStore.value!;
        trackStore.set({
            ...before,
            tracks: before.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => (clip.id === 'clip-a' ? { ...clip, endBeat: 8 } : clip)),
            })),
        });
        const original = structuredClone(clipOnTrack(TRACK_ID, 'clip-a'));
        if (scenario.action === 'trim') {
            await executeAppAction(
                { type: 'trimClipStart', payload: { clipId: 'clip-a', newStartBeat: 5 } },
                { source: 'manual' }
            );
        } else {
            await executeAppAction(
                {
                    type: 'slipClipContent',
                    payload: { clipId: 'clip-a', clipType: 'audio', offset: -4, offsetSeconds: -2 },
                },
                { source: 'manual' }
            );
        }
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({
            audioOffsetSeconds: scenario.nextSeconds,
            audioOffsetBeats: scenario.nextBeats,
        });
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toEqual(original);
        const rawUndo = getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root');
        const rawClip = rawUndo?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-a');
        expect(rawClip).toEqual(original);
        if (scenario.canonical === undefined) {
            expect(Object.hasOwn(rawClip ?? {}, 'audioOffsetSeconds')).toBe(false);
        }
        expect(undoStore.value?.future).toHaveLength(1);
        await redo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({
            audioOffsetSeconds: scenario.nextSeconds,
            audioOffsetBeats: scenario.nextBeats,
        });
        const rawRedo = getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root');
        expect(rawRedo?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-a')).toEqual(
            clipOnTrack(TRACK_ID, 'clip-a')
        );
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('hydrates an audio split with canonical source seconds and restores both fragments', async () => {
        seedAudioMoveSource(0);
        takeLaneStore.set({ lanes: [] });
        const original = structuredClone(clipOnTrack(TRACK_ID, 'clip-a'));
        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2.5, rightClipId: 'clip-right' } },
            { source: 'manual' }
        );
        expect(clipOnTrack(TRACK_ID, 'clip-right')?.audioOffsetSeconds).toBe(1.25);
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toEqual(original);
        expect(clipOnTrack(TRACK_ID, 'clip-right')).toBeUndefined();
        await redo();
        expect(clipOnTrack(TRACK_ID, 'clip-right')?.audioOffsetSeconds).toBe(1.25);
        const raw = getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root');
        expect(raw?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-right')?.audioOffsetSeconds).toBe(1.25);
    });

    it.each([false, true])('split restores later right-fragment take after redo with hydration=%s', async (reload) => {
        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' } },
            { source: 'manual' }
        );
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        if (reload) {
            hydrateProductionContracts();
        }
        const lanes = [
            {
                id: 'peer-lane',
                trackId: TRACK_ID,
                takes: [
                    {
                        id: 'peer-take',
                        clipId: 'clip-right',
                        name: 'peer take',
                        startBeat: 2,
                        endBeat: 4,
                        selected: true,
                        sourceOffsetSeconds: 0,
                    },
                ],
                activeCompRegions: [{ startBeat: 2, endBeat: 4, takeId: 'peer-take' }],
            },
        ];
        takeLaneStore.set({ lanes });
        flushAutomergeStorageWrites();
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-right')).toBeUndefined();
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(1);
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future as unknown[]).length).toBe(
                1
            )
        );
        if (reload) {
            hydrateProductionContracts();
        }
        expect(undoStore.value?.future).toHaveLength(1);
        await redo();
        expect(clipOnTrack(TRACK_ID, 'clip-right')).toMatchObject({ startBeat: 2, endBeat: 4 });
        expect({
            projection: takeLaneStore.value?.lanes,
            authority: getCrdtDoc<{ takeLanes: { lanes: unknown[] } }>('root')?.takeLanes.lanes,
        }).toEqual({ projection: lanes, authority: lanes });
    });

    it.each([
        {
            name: 'audio offset',
            corrupt: (clip: Record<string, unknown>) => {
                clip.audioOffsetBeats = 'older-file-offset';
            },
        },
        {
            name: 'canonical audio seconds',
            corrupt: (clip: Record<string, unknown>) => {
                clip.audioOffsetSeconds = 'invalid';
            },
        },
        {
            name: 'nested pitch curve',
            corrupt: (clip: Record<string, unknown>) => {
                clip.kneadState = {
                    blobs: [
                        {
                            id: 'blob-a',
                            startTime: 0,
                            endTime: 1,
                            pitchCenterCents: 12,
                            pitchCurveCents: ['bad'],
                            voicedConfidence: 0.9,
                        },
                    ],
                    retuneSpeedMs: 50,
                    humanizePercent: 10,
                    formantPreserve: true,
                };
            },
        },
    ])('rejects malformed $name capture before real undo writes', async ({ corrupt }) => {
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const entries = persisted.past as {
            inverseAction: {
                payload: {
                    clipSnapshot: Record<string, unknown>;
                    ripplePlan: { removedClips: Record<string, unknown>[] };
                };
            };
        }[];
        corrupt(entries[0]!.inverseAction.payload.clipSnapshot);
        corrupt(entries[0]!.inverseAction.payload.ripplePlan.removedClips[0]!);
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(persisted));
        const before = structuredClone(getCrdtDoc('root'));
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(0);
        await undo();
        expect(getCrdtDoc('root')).toEqual(before);
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
    });

    it('restores valid audio, link, and pitch captures without dropping optional fields', async () => {
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        const original = {
            ...createClipFixture('clip-a', 0, 4),
            type: 'audio' as const,
            audioBufferId: 'buffer-a',
            fileId: 'file-a',
            assetHash: 'hash-a',
            audioOffsetBeats: 0.25,
            midiOffsetBeats: 0.5,
            stretchMode: 'repitch' as const,
            stretchRatio: 1.2,
            loopEnabled: true,
            loopLength: 4,
            followAction: 'play_next' as const,
            generating: false,
            isGhost: false,
            isInlineEditing: true,
            parentClipId: 'parent-a',
            isLinkedInstance: true,
            sourceKeyRoot: 4,
            sourceScaleName: 'major',
            overrides: { gain: true },
            kneadState: {
                blobs: [
                    {
                        id: 'blob-a',
                        startTime: 0,
                        endTime: 1,
                        pitchCenterCents: 12,
                        originalPitchCenterCents: 10,
                        pitchCurveCents: [0, 3],
                        voicedConfidence: 0.9,
                    },
                ],
                retuneSpeedMs: 50,
                humanizePercent: 10,
                formantPreserve: true,
            },
        };
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => (clip.id === 'clip-a' ? original : clip)),
            })),
        });
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toEqual(original);
        expect(
            getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root')?.tracks.tracks[0]?.clips.find(
                (clip) => clip.id === 'clip-a'
            )
        ).toEqual(original);
    });

    it('keeps a real addClip capture with omitted optional values through remove and session reload', async () => {
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        await executeAppAction(
            {
                type: 'addClip',
                payload: {
                    id: 'new-clip',
                    trackId: TRACK_ID,
                    startBeat: 9,
                    endBeat: 13,
                    name: 'New clip',
                    type: 'midi',
                },
            },
            { source: 'manual' }
        );
        expect(clipOnTrack(TRACK_ID, 'new-clip')).toMatchObject({ startBeat: 9, endBeat: 13 });
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'new-clip' } }, { source: 'manual' });
        expect(undoStore.value?.past).toHaveLength(2);
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(2)
        );
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(2);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'new-clip')).toMatchObject({ startBeat: 9, endBeat: 13 });
        expect(
            getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root')?.tracks.tracks[0]?.clips.find(
                (clip) => clip.id === 'new-clip'
            )
        ).toMatchObject({ startBeat: 9, endBeat: 13 });
    });
});
