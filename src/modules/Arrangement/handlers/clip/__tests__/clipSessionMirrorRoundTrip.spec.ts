import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureAgentProjectInspectionState } from '#/app/captureCommandBatchPreflightState';
import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore, type AutomationLane } from '#/modules/Automation/stores';
import {
    getAutomationHandlers,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commitUndoEntry,
    createUndoEntry,
    executeAppAction,
    productionBriefAdmissionPort,
    registerProductionCommandHandlers,
    undo,
    redo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    agentProjectInspectionPort,
    getDrumPreviewBranchHandlers,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    replaceCrdtDocInLineage,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    getMidiNoteTransformHandlers,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
} from '#/modules/MIDI/useCases';
import { productionBriefActionBatchAdmission } from '#/modules/Project/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import {
    getTransportHandlers,
    prepareTimelineMapStateRestore,
    prepareTimelineMapTimeOperation,
} from '#/modules/Transport/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type HandlerSessionActionEntry } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';
import { isRecord } from '#/utils/structuralEquality';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, placeTakeOnClipMedia } from '../../../models/TakeLane';
import { type Clip } from '../../../models/Track';
import { gainEnvelopeStore, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { setWarpState, warpStateStore } from '../../../stores/warpStates';
import { takeLaneSelection } from '../../../useCases/comping/takeLaneSelection';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { commitRecording } from '../../../useCases/recording/commitRecording';
import { setTimeOperationDependencies } from '../../../useCases/timeOperations/timeOperationDependencies';
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
let stopProjectionBridge: () => void = () => undefined;

function savedMovePlacement(
    entry: unknown,
    actionName: 'inverseAction' | 'redoAction',
    placementName: 'replacement' | 'expected'
): Record<string, unknown> {
    if (!isRecord(entry)) {
        throw new Error('Expected saved move entry');
    }
    const action = entry[actionName];
    if (!isRecord(action) || !isRecord(action.payload)) {
        throw new Error('Expected saved move action');
    }
    const placement = action.payload[placementName];
    if (!isRecord(placement)) {
        throw new Error('Expected saved move placement');
    }
    return placement;
}

function savedMovePoint(
    entry: unknown,
    actionName: 'inverseAction' | 'redoAction',
    placementName: 'replacement' | 'expected'
): Record<string, unknown> {
    const placement = savedMovePlacement(entry, actionName, placementName);
    if (!Array.isArray(placement.automationLanes)) {
        throw new TypeError('Expected saved move automation lanes');
    }
    const lane = placement.automationLanes[0];
    if (!isRecord(lane) || !Array.isArray(lane.points) || !isRecord(lane.points[0])) {
        throw new Error('Expected saved move point');
    }
    return lane.points[0];
}

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

function receiveClipAudioSourceEdit(clipId: string, seconds: number | null): void {
    flushAutomergeStorageWrites();
    mutateCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>({
        id: 'root',
        changeFn: (project) => {
            let clip: Clip | undefined;
            for (const track of project.tracks.tracks) {
                clip = track.clips.find((candidate) => candidate.id === clipId);
                if (clip) {
                    break;
                }
            }
            if (!clip) {
                throw new Error(`Expected clip ${clipId} in the document`);
            }
            if (seconds === null) {
                delete clip.audioOffsetSeconds;
            } else {
                clip.audioOffsetSeconds = seconds;
            }
        },
    });
    projectCrdtToStores();
}

function receiveTakeSourceDepthEdit(takeId: string, seconds: number): void {
    flushAutomergeStorageWrites();
    mutateCrdtDoc<{
        takeLanes: { lanes: { takes: { id: string; sourceOffsetSeconds?: number }[] }[] };
    }>({
        id: 'root',
        changeFn: (project) => {
            let take: { id: string; sourceOffsetSeconds?: number } | undefined;
            for (const lane of project.takeLanes.lanes) {
                take = lane.takes.find((candidate) => candidate.id === takeId);
                if (take) {
                    break;
                }
            }
            if (!take) {
                throw new Error(`Expected take ${takeId} in the document`);
            }
            take.sourceOffsetSeconds = seconds;
        },
    });
    projectCrdtToStores();
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

function prepareAutomationMove(): AutomationLane[] {
    const first = automationLane('clip-lane-a', 'clip-a');
    first.points = [
        {
            id: 'point-a',
            beat: 0.5,
            value: 0.25,
            curve: 'bezier',
            tension: 0.3,
            cp1: { x: 0.2, y: 0.4 },
            cp2: { x: 0.7, y: 0.8 },
        },
        { id: 'point-b', beat: 2, value: 0.75, curve: 'stairs', tension: 0, stairSteps: 3 },
    ];
    first.trimPoints = [{ beat: 1, value: 0.5, curve: 'linear', tension: 0 }];
    first.ghostPoints = [{ beat: 3, value: 0.6, curve: 'smooth', tension: 0.2 }];
    const second = automationLane('clip-lane-b', 'clip-a');
    second.points = [{ id: 'point-c', beat: 1, value: 0.4, curve: 's-curve', tension: 0.1 }];
    const unrelated = automationLane('unrelated-lane');
    automationStore.set({ lanes: [first, second, unrelated] });
    flushAutomergeStorageWrites();
    setNotificationEventBus(createEventBus<NotificationEvents>());
    agentProjectInspectionPort.setProvider(captureAgentProjectInspectionState);
    productionBriefAdmissionPort.setGuard(productionBriefActionBatchAdmission.capture);
    stopProjectionBridge = setupProjectionBridge();
    projectCrdtToStores();
    return structuredClone(automationStore.value!.lanes);
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

function ownerProjections() {
    return structuredClone({
        tracks: trackStore.value,
        gain: gainEnvelopeStore.value,
        warp: warpStateStore.value,
        automation: automationStore.value,
        midi: midiStore.value,
        takes: takeLaneStore.value,
    });
}

function syncPeerTakes(edit: (project: { takeLanes: NonNullable<typeof takeLaneStore.value> }) => void): void {
    const current = getCrdtDoc<{ takeLanes: NonNullable<typeof takeLaneStore.value> }>('root');
    if (!current) {
        throw new Error('Expected a shared project genesis');
    }
    let local = Automerge.clone(current);
    let peer = Automerge.change(Automerge.clone(current), edit);
    let localSync = Automerge.initSyncState();
    let peerSync = Automerge.initSyncState();
    expect(Automerge.getHeads(peer)).not.toEqual(Automerge.getHeads(local));
    for (let round = 0; round < 16; round += 1) {
        let message: Uint8Array | null;
        [peerSync, message] = Automerge.generateSyncMessage(peer, peerSync);
        if (message) {
            [local, localSync] = Automerge.receiveSyncMessage(local, localSync, message);
        }
        let reply: Uint8Array | null;
        [localSync, reply] = Automerge.generateSyncMessage(local, localSync);
        if (reply) {
            [peer, peerSync] = Automerge.receiveSyncMessage(peer, peerSync, reply);
        }
        if (!message && !reply) {
            expect(Automerge.getHeads(local)).toEqual(Automerge.getHeads(peer));
            replaceCrdtDocInLineage({ id: 'root', doc: local });
            projectCrdtToStores();
            return;
        }
    }
    throw new Error('Peer take edit did not converge');
}

async function persistRemovalWithDistinctOwners() {
    workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
    for (const [clipId, gainDb, warpedBeat] of [
        ['clip-a', -6, 0.5],
        ['clip-b', -18, 1.75],
    ] as const) {
        setEnvelope(clipId, {
            clipId,
            enabled: true,
            points: [{ id: `gain-${clipId}`, beatOffset: 0, gainDb }],
        });
        setWarpState(clipId, {
            enabled: true,
            markers: [{ id: `warp-${clipId}`, originalBeat: 0, warpedBeat }],
            stretchMode: 'repitch',
            originalTempo: 120,
        });
    }
    const lanes = [
        automationLane('removed-lane-a', 'clip-a'),
        automationLane('removed-lane-b', 'clip-a'),
        automationLane('retained-lane', 'clip-b'),
    ];
    lanes[1]!.points[0]!.value = 0.75;
    lanes[2]!.points[0]!.value = 0.9;
    automationStore.set({ lanes });
    flushAutomergeStorageWrites();
    stopProjectionBridge = setupProjectionBridge();
    projectCrdtToStores();
    const original = ownerProjections();

    await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
    await vi.waitFor(() =>
        expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
    );
    const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
    if (!Array.isArray(saved.past) || !isRecord(saved.past[0])) {
        throw new Error('Expected real persisted removeClip entry');
    }
    const inverse = saved.past[0].inverseAction;
    if (!isRecord(inverse) || !isRecord(inverse.payload) || !isRecord(inverse.payload.ripplePlan)) {
        throw new Error('Expected real persisted restoreClip ripple plan');
    }
    const plan = inverse.payload.ripplePlan;
    expect(plan).toMatchObject({
        removedClips: [{ id: 'clip-a' }],
        clipSatellites: [
            {
                clipId: 'clip-a',
                gainEnvelope: original.gain?.envelopes['clip-a'],
                warpState: original.warp?.states['clip-a'],
            },
        ],
        clipAutomationLanes: lanes.slice(0, 2),
    });
    expect(plan.clipSatellites).toHaveLength(1);
    expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
    expect(gainEnvelopeStore.value?.envelopes['clip-a']).toBeUndefined();
    expect(warpStateStore.value?.states['clip-a']).toBeUndefined();
    expect(automationStore.value?.lanes).toEqual([lanes[2]]);
    return { saved, plan, original };
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
        stopProjectionBridge();
        stopProjectionBridge = () => undefined;
        setTimeOperationDependencies(null);
        agentProjectInspectionPort.setProvider(null);
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
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

    it.each(['satellite', 'automation'] as const)(
        'rejects a saved removeClip with a foreign %s owner before hydration and Undo',
        async (owner) => {
            const { saved, plan } = await persistRemovalWithDistinctOwners();
            if (owner === 'satellite') {
                if (
                    !Array.isArray(plan.clipSatellites) ||
                    !isRecord(plan.clipSatellites[0]) ||
                    !isRecord(plan.clipSatellites[0].gainEnvelope)
                ) {
                    throw new Error('Expected captured clip-a satellite');
                }
                plan.clipSatellites[0].clipId = 'clip-b';
                plan.clipSatellites[0].gainEnvelope.clipId = 'clip-b';
            } else {
                if (!Array.isArray(plan.clipAutomationLanes) || !isRecord(plan.clipAutomationLanes[0])) {
                    throw new Error('Expected captured clip-a automation lane');
                }
                plan.clipAutomationLanes[0].clipId = 'clip-b';
            }
            sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
            const beforeRaw = structuredClone(getCrdtDoc('root'));
            const beforeOwners = ownerProjections();

            hydrateProductionContracts();
            expect(undoHistoryStore.value?.past).toEqual([]);
            expect(undoHistoryStore.value?.future).toEqual([]);
            const hydratedHistory = structuredClone(undoHistoryStore.value);
            expect(getCrdtDoc('root')).toEqual(beforeRaw);
            expect(ownerProjections()).toEqual(beforeOwners);

            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(beforeRaw);
            expect(ownerProjections()).toEqual(beforeOwners);
            expect(undoHistoryStore.value).toEqual(hydratedHistory);
        }
    );

    it('restores only the removed owner from a genuine saved gain, warp, and multiple automation capture', async () => {
        const { original } = await persistRemovalWithDistinctOwners();
        const removedRaw = structuredClone(getCrdtDoc('root'));
        const removedOwners = ownerProjections();
        hydrateProductionContracts();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toEqual([]);

        for (let round = 0; round < 2; round += 1) {
            expect((await undo()).headConsumed).toBe(true);
            expect(clipOnTrack(TRACK_ID, 'clip-a')).toEqual(original.tracks?.tracks[0]?.clips[0]);
            expect(clipOnTrack(TRACK_ID, 'clip-b')).toEqual(original.tracks?.tracks[0]?.clips[1]);
            expect(gainEnvelopeStore.value).toEqual(original.gain);
            expect(warpStateStore.value).toEqual(original.warp);
            const restoredLanes = [original.automation!.lanes[2], ...original.automation!.lanes.slice(0, 2)];
            expect(automationStore.value?.lanes).toEqual(restoredLanes);
            expect(getCrdtDoc('root')).toMatchObject({
                gainEnvelopes: original.gain,
                warpStates: original.warp,
                automation: { lanes: restoredLanes },
            });
            expect(undoHistoryStore.value?.past).toEqual([]);
            expect(undoHistoryStore.value?.future).toHaveLength(1);

            await redo();
            expect(getCrdtDoc('root')).toEqual(removedRaw);
            expect(ownerProjections()).toEqual(removedOwners);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            expect(undoHistoryStore.value?.future).toEqual([]);
        }
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
        { name: 'duplicate captured sibling identity', replacementId: 'clip-lane-a', replaceBoth: false },
        {
            name: 'captured siblings colliding with a resident lane',
            replacementId: 'unrelated-lane',
            replaceBoth: true,
        },
    ])(
        'rejects saved removeClip with $name before Undo can consume history',
        async ({ replacementId, replaceBoth }) => {
            const first = automationLane('clip-lane-a', 'clip-a');
            const second = automationLane('clip-lane-b', 'clip-a');
            second.points[0]!.value = 0.75;
            automationStore.set({ lanes: [first, second, automationLane('unrelated-lane')] });
            flushAutomergeStorageWrites();

            await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
            await vi.waitFor(() =>
                expect(
                    (parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length
                ).toBe(1)
            );
            const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            const entries = persisted.past as {
                inverseAction: { payload: { ripplePlan: { clipAutomationLanes: { id: string }[] } } };
            }[];
            const captured = entries[0]!.inverseAction.payload.ripplePlan.clipAutomationLanes;
            expect(captured.map((lane) => lane.id)).toEqual(['clip-lane-a', 'clip-lane-b']);
            if (replaceBoth) {
                captured[0]!.id = replacementId;
            }
            captured[1]!.id = replacementId;
            sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(persisted));

            const beforeRaw = structuredClone(getCrdtDoc('root'));
            const beforeTrack = structuredClone(trackStore.value);
            const beforeMidi = structuredClone(midiStore.value);
            const beforeGain = structuredClone(gainEnvelopeStore.value);
            const beforeWarp = structuredClone(warpStateStore.value);
            const beforeTakes = structuredClone(takeLaneStore.value);
            const beforeAutomation = structuredClone(automationStore.value);
            hydrateProductionContracts();
            expect(undoHistoryStore.value?.past).toEqual([]);
            expect(undoHistoryStore.value?.future).toEqual([]);
            const hydratedHistory = structuredClone(undoHistoryStore.value);

            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(beforeRaw);
            expect(trackStore.value).toEqual(beforeTrack);
            expect(midiStore.value).toEqual(beforeMidi);
            expect(gainEnvelopeStore.value).toEqual(beforeGain);
            expect(warpStateStore.value).toEqual(beforeWarp);
            expect(takeLaneStore.value).toEqual(beforeTakes);
            expect(automationStore.value).toEqual(beforeAutomation);
            expect(undoHistoryStore.value).toEqual(hydratedHistory);
        }
    );

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

    it.each(['lone-anchor', 'invalid-depth'] as const)(
        'refuses a genuinely captured move with %s before saved replay',
        async (corruption) => {
            seedAudioMoveSource(0);
            const clip = clipOnTrack(TRACK_ID, 'clip-a');
            if (!clip) {
                throw new Error('Expected the recording clip');
            }
            await commitRecording(clip, { provisionalStartBeat: 0, mediaOriginSeconds: 0 });
            clearUndoHistory();
            await executeAppAction(
                { type: 'moveClip', payload: { clipId: clip.id, trackId: TRACK_ID, startBeat: 5.5 } },
                { source: 'manual' }
            );
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
            );
            const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            const entry = (saved.past as unknown[])[0];
            for (const [action, point] of [
                ['inverseAction', 'expected'],
                ['redoAction', 'replacement'],
            ] as const) {
                const sources = savedMovePlacement(entry, action, point).takeSources;
                if (!Array.isArray(sources) || !isRecord(sources[0])) {
                    throw new Error('Expected a real paired take-source capture');
                }
                expect(sources[0]).toHaveProperty('passAnchorSeconds');
                expect(sources[0]).toHaveProperty('passDepthSeconds');
                if (corruption === 'lone-anchor') {
                    delete sources[0].passDepthSeconds;
                } else {
                    sources[0].passDepthSeconds = -1;
                }
            }
            sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
            const raw = structuredClone(getCrdtDoc('root'));
            const owners = ownerProjections();
            hydrateProductionContracts();
            expect(undoStore.value?.past).toHaveLength(0);
            await undo();
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(ownerProjections()).toEqual(owners);
        }
    );

    it.each(['split', 'trim', 'move'] as const)(
        'hydrates a genuine placed canonical pass through %s and real replay',
        async (edit) => {
            workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
            const audio: Clip = {
                ...createClipFixture('recorded-audio', 8, 16),
                type: 'audio',
                audioBufferId: 'recorded-loop-buffer',
                audioOffsetBeats: -4,
                audioOffsetSeconds: -2,
                stretchMode: 'repitch',
                stretchRatio: 1.5,
            };
            trackStore.set({
                tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'audio', clips: [audio] })],
                selectedTrackId: TRACK_ID,
                ghostClips: [],
            });
            const take = { ...createTake(audio.id, 'Pass 2', 8, 16, 4), sourceOffsetSeconds: 1, selected: true };
            const lane = {
                ...createTakeLane(TRACK_ID),
                takes: [take],
                activeCompRegions: [{ startBeat: 8, endBeat: 16, takeId: take.id }],
            };
            takeLaneStore.set({ lanes: [lane] });
            flushAutomergeStorageWrites();
            await commitRecording(audio, { provisionalStartBeat: 12, mediaOriginSeconds: 6 });
            flushAutomergeStorageWrites();
            projectCrdtToStores();
            const before = structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
            expect(before.takes?.lanes[0]?.takes[0]).toMatchObject({
                sourceOffsetBeats: 4,
                sourceOffsetSeconds: 1,
                passAnchorSeconds: -2,
                passDepthSeconds: 2,
            });
            clearUndoHistory();
            tempoMapStore.set({
                changes: [
                    { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'slow', beat: 12, tempo: 60, curve: 'instant' },
                ],
            });
            flushAutomergeStorageWrites();
            const rawBefore = structuredClone(getCrdtDoc<{ tracks: unknown; takeLanes: unknown }>('root'));
            if (edit === 'split') {
                await executeAppAction(
                    { type: 'splitClip', payload: { clipId: audio.id, beat: 12, rightClipId: 'recorded-right' } },
                    { source: 'manual' }
                );
            } else if (edit === 'trim') {
                await executeAppAction(
                    { type: 'trimClipStart', payload: { clipId: audio.id, newStartBeat: 10 } },
                    { source: 'manual' }
                );
            } else {
                await executeAppAction(
                    { type: 'moveClip', payload: { clipId: audio.id, trackId: TRACK_ID, startBeat: 16 } },
                    { source: 'manual' }
                );
            }
            flushAutomergeStorageWrites();
            const rawAfter = structuredClone(getCrdtDoc<{ tracks: unknown; takeLanes: unknown }>('root'));
            const after = structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
            expect(
                after.takes?.lanes
                    .flatMap((value) => value.takes)
                    .every(
                        (value) =>
                            value.passAnchorSeconds === -2 &&
                            value.passDepthSeconds === 2 &&
                            value.sourceOffsetSeconds === 1
                    )
            ).toBe(true);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
            );
            const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            if (edit !== 'trim') {
                expect(JSON.stringify(saved.past)).toContain('passAnchorSeconds');
                expect(JSON.stringify(saved.past)).toContain('passDepthSeconds');
            }
            const currentTracks = trackStore.value;
            if (!currentTracks) {
                throw new Error('Expected the current track projection');
            }
            const currentUi = { selectedTrackId: null, ghostClips: [{ ...audio, id: 'current-preview' }] };
            trackStore.set({ ...currentTracks, ...currentUi });
            hydrateProductionContracts();
            expect(undoStore.value?.past).toHaveLength(1);
            await undo();
            expect({ tracks: trackStore.value?.tracks, takes: takeLaneStore.value }).toEqual({
                tracks: before.tracks?.tracks,
                takes: before.takes,
            });
            expect({
                selectedTrackId: trackStore.value?.selectedTrackId,
                ghostClips: trackStore.value?.ghostClips,
            }).toEqual(currentUi);
            const rawUndone = getCrdtDoc<{ tracks: unknown; takeLanes: unknown }>('root');
            expect({ tracks: rawUndone?.tracks, takeLanes: rawUndone?.takeLanes }).toEqual({
                tracks: rawBefore?.tracks,
                takeLanes: rawBefore?.takeLanes,
            });
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
            );
            hydrateProductionContracts();
            expect(undoStore.value?.future).toHaveLength(1);
            await redo();
            expect({ tracks: trackStore.value?.tracks, takes: takeLaneStore.value }).toEqual({
                tracks: after.tracks?.tracks,
                takes: after.takes,
            });
            expect({
                selectedTrackId: trackStore.value?.selectedTrackId,
                ghostClips: trackStore.value?.ghostClips,
            }).toEqual(currentUi);
            const rawRedone = getCrdtDoc<{ tracks: unknown; takeLanes: unknown }>('root');
            expect({ tracks: rawRedone?.tracks, takeLanes: rawRedone?.takeLanes }).toEqual({
                tracks: rawAfter?.tracks,
                takeLanes: rawAfter?.takeLanes,
            });
        }
    );

    it('removeClip retains placed audio pass fields through saved history and both replay directions', async () => {
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        const audio: Clip = {
            ...createClipFixture('recorded-audio', 8, 16),
            type: 'audio',
            audioBufferId: 'recorded-loop-buffer',
            audioOffsetBeats: -4,
            audioOffsetSeconds: -2,
        };
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'audio', clips: [audio] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        // A recording begun at beat 12 in loop [8, 16): the second pass
        // sounds before the media origin and reads two seconds into it.
        const placed = placeTakeOnClipMedia(
            { ...createTake(audio.id, 'Pass 2', 8, 16, 4), sourceOffsetSeconds: 1, selected: true },
            {
                recordPointBeat: 12,
                mediaOriginSeconds: 6,
                clipMediaOriginSeconds: 6,
                timeline: {
                    secondsAtBeat: (beat) => beat / 2,
                    beatAtSeconds: (seconds) => seconds * 2,
                    tempoAtBeat: () => 120,
                },
            }
        );
        const lane = {
            ...createTakeLane(TRACK_ID),
            takes: [placed],
            activeCompRegions: [{ startBeat: 8, endBeat: 16, takeId: placed.id }],
        };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        expect(placed).toMatchObject({ sourceOffsetBeats: 4, passAnchorSeconds: -2, passDepthSeconds: 2 });
        expect(takeLaneStore.value?.lanes).toEqual([lane]);
        expect(getCrdtDoc<{ takeLanes: { lanes: unknown[] } }>('root')?.takeLanes.lanes).toEqual([lane]);

        await executeAppAction({ type: 'removeClip', payload: { clipId: audio.id } }, { source: 'manual' });
        await vi.waitFor(() => {
            const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            expect(saved.past).toHaveLength(1);
            expect(saved.past).toMatchObject([
                {
                    inverseAction: {
                        type: 'restoreClip',
                        payload: { retiredTakeLanes: [{ lane, retiredTakeIds: [placed.id] }] },
                    },
                },
            ]);
        });
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        expect(clipOnTrack(TRACK_ID, audio.id)).toBeUndefined();
        expect(takeLaneStore.value?.lanes).toEqual([]);
        await undo();
        expect(clipOnTrack(TRACK_ID, audio.id)).toEqual(audio);
        expect(takeLaneStore.value?.lanes).toEqual([lane]);
        expect(getCrdtDoc<{ takeLanes: { lanes: unknown[] } }>('root')?.takeLanes.lanes).toEqual([lane]);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
        );
        hydrateProductionContracts();
        expect(undoStore.value?.future).toHaveLength(1);
        await redo();
        expect(clipOnTrack(TRACK_ID, audio.id)).toBeUndefined();
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expect(getCrdtDoc<{ takeLanes: { lanes: unknown[] } }>('root')?.takeLanes.lanes).toEqual([]);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('rehydrates a rich paired move capture and restores exact automation with real Undo and Redo', async () => {
        const originalLanes = prepareAutomationMove();
        await executeAppAction(
            { type: 'moveClip', payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 9 } },
            { source: 'manual' }
        );
        const movedLanes = structuredClone(automationStore.value?.lanes);
        const movedAuthority = structuredClone(getCrdtDoc('root'));
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const past = saved.past;
        if (!Array.isArray(past)) {
            throw new TypeError('Expected persisted history');
        }
        expect(savedMovePoint(past[0], 'inverseAction', 'replacement')).toMatchObject(originalLanes[0]!.points[0]!);
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ startBeat: 0, endBeat: 4 });
        expect(automationStore.value?.lanes).toEqual(originalLanes);
        expect(getCrdtDoc<{ automation: { lanes: AutomationLane[] } }>('root')?.automation.lanes).toEqual(
            originalLanes
        );
        await redo();
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ startBeat: 9, endBeat: 13 });
        expect(automationStore.value?.lanes).toEqual(movedLanes);
        expect(getCrdtDoc('root')).toEqual(movedAuthority);
    });

    it.each([
        {
            name: 'unsupported curve',
            corrupt: (point: Record<string, unknown>) => {
                point.curve = 'unsupported';
            },
        },
        {
            name: 'negative beat',
            corrupt: (point: Record<string, unknown>) => {
                point.beat = -1;
            },
        },
        {
            name: 'empty point id',
            corrupt: (point: Record<string, unknown>) => {
                point.id = '';
            },
        },
        {
            name: 'negative stair steps',
            corrupt: (point: Record<string, unknown>) => {
                point.stairSteps = -1;
            },
        },
    ])('rejects paired saved move automation with $name before real Undo writes', async ({ corrupt }) => {
        prepareAutomationMove();
        await executeAppAction(
            { type: 'moveClip', payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 9 } },
            { source: 'manual' }
        );
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        const past = saved.past;
        if (!Array.isArray(past)) {
            throw new TypeError('Expected persisted history');
        }
        corrupt(savedMovePoint(past[0], 'inverseAction', 'replacement'));
        corrupt(savedMovePoint(past[0], 'redoAction', 'expected'));
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
        const beforeAuthority = structuredClone(getCrdtDoc('root'));
        const beforeTracks = structuredClone(trackStore.value);
        const beforeAutomation = structuredClone(automationStore.value);
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(0);
        await undo();
        expect(getCrdtDoc('root')).toEqual(beforeAuthority);
        expect(trackStore.value).toEqual(beforeTracks);
        expect(automationStore.value).toEqual(beforeAutomation);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(0);
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
                receiveClipAudioSourceEdit('clip-a', 7);
            } else {
                receiveTakeSourceDepthEdit('take-1', 7);
            }
            const rawPeer = structuredClone(
                getCrdtDoc<{
                    tracks: { tracks: { clips: Clip[] }[] };
                    takeLanes: { lanes: { takes: { id: string; sourceOffsetSeconds?: number }[] }[] };
                }>('root')
            );
            if (field === 'clip') {
                expect(rawPeer?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-a')?.audioOffsetSeconds).toBe(
                    7
                );
                expect(clipOnTrack(TRACK_ID, 'clip-a')?.audioOffsetSeconds).toBe(7);
            } else {
                expect(
                    rawPeer?.takeLanes.lanes[0]?.takes.find((take) => take.id === 'take-1')?.sourceOffsetSeconds
                ).toBe(7);
                expect(
                    takeLaneStore.value?.lanes[0]?.takes.find((take) => take.id === 'take-1')?.sourceOffsetSeconds
                ).toBe(7);
            }
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
            receiveClipAudioSourceEdit('clip-a', peerSource === 'absent' ? null : 7);
            const rawPeer = structuredClone(getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root'));
            const rawClip = rawPeer?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-a');
            if (peerSource === 'absent') {
                expect(Object.hasOwn(rawClip ?? {}, 'audioOffsetSeconds')).toBe(false);
                expect(Object.hasOwn(clipOnTrack(TRACK_ID, 'clip-a') ?? {}, 'audioOffsetSeconds')).toBe(false);
            } else {
                expect(rawClip?.audioOffsetSeconds).toBe(7);
                expect(clipOnTrack(TRACK_ID, 'clip-a')?.audioOffsetSeconds).toBe(7);
            }
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

    it('hydrates a settled Delete Time capture with canonical-zero audio source and restores it', async () => {
        setTimeOperationDependencies({
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore,
            prepareTimelineMapTimeOperation,
            prepareTimelineMapStateRestore,
        });
        seedAudioMoveSource(0);
        takeLaneStore.set({ lanes: [] });
        const beforePlacement = trackStore.value!;
        trackStore.set({
            ...beforePlacement,
            tracks: beforePlacement.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => (clip.id === 'clip-a' ? { ...clip, startBeat: 3, endBeat: 7 } : clip)),
            })),
        });
        flushAutomergeStorageWrites();
        const rawBefore = structuredClone(getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root'));
        const original = structuredClone(clipOnTrack(TRACK_ID, 'clip-a'));
        expect(rawBefore?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-a')).toEqual(original);
        expect(original).toMatchObject({ audioOffsetSeconds: 0, audioOffsetBeats: 9, startBeat: 3, endBeat: 7 });

        await executeAppAction({ type: 'deleteTime', payload: { startBeat: 1, endBeat: 2 } }, { source: 'manual' });
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({
            audioOffsetSeconds: 0,
            startBeat: 2,
            endBeat: 6,
        });
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        const after = structuredClone(clipOnTrack(TRACK_ID, 'clip-a'));
        const rawAfter = structuredClone(getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root'));
        expect(rawAfter?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'clip-a')).toEqual(after);
        hydrateProductionContracts();
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(undoStore.value?.future).toHaveLength(1);
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toEqual(original);
        expect(
            getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root')?.tracks.tracks[0]?.clips.find(
                (clip) => clip.id === 'clip-a'
            )
        ).toEqual(original);
        await redo();
        expect(undoStore.value?.past).toHaveLength(1);
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toEqual(after);
        expect(
            getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root')?.tracks.tracks[0]?.clips.find(
                (clip) => clip.id === 'clip-a'
            )
        ).toEqual(after);
    });

    it('split hydrated redo keeps a later synced surviving take as the unique selection', async () => {
        flushAutomergeStorageWrites();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' } },
            { source: 'manual' }
        );
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(1)
        );
        hydrateProductionContracts();
        const retired = {
            id: 'peer-right-take',
            clipId: 'clip-right',
            name: 'Peer right pass',
            startBeat: 2,
            endBeat: 4,
            sourceOffsetBeats: 8,
            selected: true,
        };
        syncPeerTakes((project) => {
            project.takeLanes.lanes.push({
                id: 'peer-lane',
                trackId: TRACK_ID,
                takes: [retired],
                activeCompRegions: [{ startBeat: 2, endBeat: 4, takeId: retired.id }],
            });
        });
        expect(takeLaneStore.value?.lanes[0]?.takes).toEqual([retired]);
        await undo();
        expect(clipOnTrack(TRACK_ID, 'clip-right')).toBeUndefined();
        expect(takeLaneStore.value?.lanes).toEqual([]);
        await vi.waitFor(() =>
            expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future as unknown[]).length).toBe(
                1
            )
        );
        hydrateProductionContracts();
        const later = {
            id: 'peer-left-take',
            clipId: 'clip-a',
            name: 'Later peer choice',
            startBeat: 0,
            endBeat: 2,
            selected: true,
        };
        syncPeerTakes((project) => {
            project.takeLanes.lanes.push({
                id: 'peer-lane',
                trackId: TRACK_ID,
                takes: [later],
                activeCompRegions: [{ startBeat: 0.5, endBeat: 1.5, takeId: later.id }],
            });
        });
        const history = structuredClone(undoHistoryStore.value);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
        expect(history?.future).toHaveLength(1);
        await redo();
        expect(clipOnTrack(TRACK_ID, 'clip-right')).toMatchObject({ startBeat: 2, endBeat: 4 });
        const expected = [
            {
                id: 'peer-lane',
                trackId: TRACK_ID,
                takes: [{ ...retired, selected: false }, later],
                activeCompRegions: [
                    { startBeat: 0.5, endBeat: 1.5, takeId: later.id },
                    { startBeat: 2, endBeat: 4, takeId: retired.id },
                ],
            },
        ];
        expect(takeLaneStore.value?.lanes).toEqual(expected);
        expect(getCrdtDoc<{ takeLanes: { lanes: unknown[] } }>('root')?.takeLanes.lanes).toEqual(expected);
        expect(takeLaneStore.value?.lanes[0]?.takes.filter((take) => take.selected)).toEqual([later]);
        expect(
            takeLaneSelection.resolve(takeLaneStore.value!, {
                type: 'selectTake',
                payload: { trackId: TRACK_ID, takeId: later.id },
            })?.selectedTakeId
        ).toBe(later.id);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
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
