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
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore, undoStore } from '#/modules/Command/stores';
import {
    commitUndoEntry,
    createUndoEntry,
    isAppActionCommittedError,
    executeAppAction,
    executeAppActionBatch,
    productionBriefAdmissionPort,
    registerProductionCommandHandlers,
    undo,
    redo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    createCrdtDoc,
    getCrdtDoc,
    agentProjectInspectionPort,
    projectCrdtToStores,
    getDrumPreviewBranchHandlers,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    mutateCrdtDoc,
    resetCrdtProjectAuthority,
    replaceCrdtDocInLineage,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { productionBriefActionBatchAdmission } from '#/modules/Project/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';
import { isRecord } from '#/utils/structuralEquality';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, placeTakeOnClipMedia } from '../../../models/TakeLane';
import { createTrack, type Clip } from '../../../models/Track';
import { gainEnvelopeStore, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { setWarpState, warpStateStore } from '../../../stores/warpStates';
import { takeLaneSelection } from '../../../useCases/comping/takeLaneSelection';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { handleDiscardDrawnClip } from '../handleDiscardDrawnClip';
import { handleDiscardDuplicatedClip } from '../handleDiscardDuplicatedClip';
import { handleDrawClip } from '../handleDrawClip';
import { handleDuplicateClipAt } from '../handleDuplicateClipAt';
import { handleMoveClips } from '../handleMoveClips';
import { handleRemoveClip } from '../handleRemoveClip';
import { handleRestoreClipMoves } from '../handleRestoreClipMoves';
import { handleRestoreDrawnClip } from '../handleRestoreDrawnClip';

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const TRACK_ID = 'track-keys';
type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};
let stopProjectionBridge: () => void = () => undefined;

function savedMovePoint(
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
    if (!isRecord(placement) || !Array.isArray(placement.automationLanes)) {
        throw new Error('Expected saved move placement');
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

type PeerProject = {
    automation: NonNullable<typeof automationStore.value>;
    takeLanes: NonNullable<typeof takeLaneStore.value>;
    tracks: NonNullable<typeof trackStore.value>;
    midi: NonNullable<typeof midiStore.value>;
    gainEnvelopes: NonNullable<typeof gainEnvelopeStore.value>;
    warpStates: NonNullable<typeof warpStateStore.value>;
};

function syncPeerProject(edit: (project: PeerProject) => void): void {
    const current = getCrdtDoc<PeerProject>('root');
    if (!current) {
        throw new Error('Expected a shared project genesis');
    }
    let local = Automerge.clone(current);
    let peer = Automerge.change(Automerge.clone(current), edit);
    let localSync = Automerge.initSyncState();
    let peerSync = Automerge.initSyncState();
    expect(Automerge.getActorId(peer)).not.toBe(Automerge.getActorId(local));
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
    throw new Error('Peer project edit did not converge');
}

function reloadSavedProject(): void {
    flushAutomergeStorageWrites();
    const current = getCrdtDoc('root');
    if (!current) {
        throw new Error('Expected a project to save');
    }
    const saved = Automerge.save(current);
    const loaded = Automerge.load(saved);
    expect(loaded).toEqual(current);
    expect(Automerge.getHeads(loaded)).toEqual(Automerge.getHeads(current));
    replaceCrdtDocInLineage({ id: 'root', doc: loaded });
    projectCrdtToStores({ resetProjections: true });
    hydrateProductionContracts();
}

async function expectReplayRefused(replay: 'undo' | 'redo'): Promise<void> {
    const raw = structuredClone(getCrdtDoc('root'));
    const heads = Automerge.getHeads(getCrdtDoc('root')!);
    const owners = ownerProjections();
    const history = structuredClone(undoHistoryStore.value);
    const writes = [
        vi.spyOn(trackStore, 'set'),
        vi.spyOn(midiStore, 'set'),
        vi.spyOn(gainEnvelopeStore, 'set'),
        vi.spyOn(warpStateStore, 'set'),
        vi.spyOn(automationStore, 'set'),
        vi.spyOn(takeLaneStore, 'set'),
        vi.spyOn(undoHistoryStore, 'set'),
    ];
    try {
        if (replay === 'undo') {
            expect.soft((await undo()).headConsumed).toBe(false);
        } else {
            await redo();
        }
        expect.soft(getCrdtDoc('root')).toEqual(raw);
        expect.soft(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(heads);
        expect.soft(ownerProjections()).toEqual(owners);
        expect.soft(undoHistoryStore.value).toEqual(history);
        for (const write of writes) {
            expect.soft(write).not.toHaveBeenCalled();
        }
    } finally {
        for (const write of writes) {
            write.mockRestore();
        }
    }
    projectCrdtToStores({ resetProjections: true });
    expect.soft(ownerProjections()).toEqual(owners);
}

function refuseBatchAtCommit(): void {
    let captures = 0;
    productionBriefAdmissionPort.setGuard(() => {
        const captureOrdinal = ++captures;
        let checks = 0;
        return {
            allowsCurrent: () => captureOrdinal !== 2 || ++checks === 1,
        };
    });
}

function savedSplitSnapshot(
    entry: unknown,
    actionName: 'inverseAction' | 'redoAction',
    side: 'expected' | 'replacement'
): Record<string, unknown> {
    if (!isRecord(entry) || !isRecord(entry[actionName])) {
        throw new Error('Expected saved split action');
    }
    const payload = entry[actionName].payload;
    if (!isRecord(payload) || !isRecord(payload[side])) {
        throw new Error('Expected saved split snapshot');
    }
    return payload[side];
}

async function persistRemovalWithDistinctOwners(grouped = false) {
    workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
    if (grouped) {
        trackStore.set({
            ...trackStore.value!,
            tracks: trackStore.value!.tracks.map((track) => ({
                ...track,
                clips: [...track.clips, createClipFixture('clip-c', 8, 12)],
            })),
        });
    }
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

    const removal = { type: 'removeClip' as const, payload: { clipId: 'clip-a' } };
    if (grouped) {
        const result = await executeAppActionBatch([removal, { type: 'removeClip', payload: { clipId: 'clip-c' } }], {
            source: 'manual',
            groupId: 'saved-removal-group',
        });
        expect(result.status).toBe('committed');
    } else {
        await executeAppAction(removal, { source: 'manual' });
    }
    await vi.waitFor(() =>
        expect((parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past as unknown[]).length).toBe(
            grouped ? 2 : 1
        )
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

async function persistRippleRemoval(grouped: boolean, automated = true, fractional = false): Promise<void> {
    const offset = fractional ? 0.125 : 0;
    trackStore.set({
        tracks: [
            TrackDummy.create({
                id: TRACK_ID,
                kind: 'midi',
                clips: [
                    createClipFixture('clip-a', offset, 4 + offset),
                    createClipFixture('clip-b', 4 + offset, 8 + offset),
                ],
            }),
            {
                ...createTrack({ id: 'other-track', kind: 'midi', name: 'Other Track' }),
                clips: [
                    { ...createClipFixture('clip-c', 2, 4), trackId: 'other-track' },
                    { ...createClipFixture('peer-clip', 0, 1), trackId: 'other-track' },
                ],
            },
        ],
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
    const shiftedLane = automationLane('shifted-lane', 'clip-b');
    shiftedLane.points = [
        {
            id: 'shift-start',
            beat: 4.5 + offset,
            value: 0.25,
            curve: 'bezier',
            tension: 0.3,
            cp1: { x: 0.2, y: 0.4 },
            cp2: { x: 0.7, y: 0.8 },
        },
        { id: 'shift-end', beat: 7.5 + offset, value: 0.75, curve: 'stairs', tension: 0, stairSteps: 3 },
    ];
    automationStore.set({ lanes: automated ? [shiftedLane] : [] });
    flushAutomergeStorageWrites();
    stopProjectionBridge = setupProjectionBridge();
    projectCrdtToStores();
    if (grouped) {
        const result = await executeAppActionBatch(
            [
                { type: 'removeClip', payload: { clipId: 'clip-a' } },
                { type: 'removeClip', payload: { clipId: 'clip-c' } },
            ],
            { source: 'manual', groupId: 'saved-ripple-removal' }
        );
        expect(result).toMatchObject({ status: 'committed' });
    } else {
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
    }
    await vi.waitFor(() => {
        const past = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past;
        expect(past).toHaveLength(grouped ? 2 : 1);
    });
    reloadSavedProject();
    expect(clipOnTrack(TRACK_ID, 'clip-b')).toMatchObject({ startBeat: offset, endBeat: 4 + offset });
    expect(undoHistoryStore.value?.past).toHaveLength(grouped ? 2 : 1);
}

async function persistSequentialRippleGroup(secondRipples = true): Promise<void> {
    trackStore.set({
        tracks: [
            TrackDummy.create({
                id: TRACK_ID,
                kind: 'midi',
                clips: [
                    createClipFixture('clip-a', 0.125, 4.125),
                    createClipFixture('clip-c', 4.125, 8.125),
                    createClipFixture('clip-b', 8.125, 12.125),
                ],
            }),
        ],
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
    automationStore.set({
        lanes: [
            automationLane('first-removed-lane', 'clip-a'),
            {
                ...automationLane('restored-prefix-lane', 'clip-c'),
                points: [{ id: 'c-point', beat: 4.625, value: 0.3, curve: 'linear', tension: 0 }],
            },
            {
                ...automationLane('shared-shifted-lane', 'clip-b'),
                points: [
                    {
                        id: 'b-point',
                        beat: 8.625,
                        value: 0.7,
                        curve: 'bezier',
                        tension: 0.2,
                        cp1: { x: 0.2, y: 0.4 },
                        cp2: { x: 0.7, y: 0.8 },
                    },
                ],
            },
        ],
    });
    flushAutomergeStorageWrites();
    stopProjectionBridge = setupProjectionBridge();
    projectCrdtToStores();
    for (const clipId of ['clip-a', 'clip-c']) {
        if (clipId === 'clip-c' && !secondRipples) {
            workspaceStore.set({ ...workspaceStore.value!, rippleEditing: false });
        }
        await executeAppAction(
            { type: 'removeClip', payload: { clipId } },
            { source: 'manual', groupId: 'sequential-ripple' }
        );
    }
    await vi.waitFor(() =>
        expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(2)
    );
    reloadSavedProject();
    expect(undoHistoryStore.value?.past).toHaveLength(2);
    expect(clipOnTrack(TRACK_ID, 'clip-b')).toMatchObject({
        startBeat: secondRipples ? 0.125 : 4.125,
        endBeat: secondRipples ? 4.125 : 8.125,
    });
}

async function persistSplitRemoveGroup() {
    workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
    flushAutomergeStorageWrites();
    prepareAutomationMove();
    setEnvelope('clip-a', {
        clipId: 'clip-a',
        enabled: true,
        points: [{ id: 'gain-group', beatOffset: 1, gainDb: -6 }],
    });
    setWarpState('clip-a', {
        enabled: true,
        stretchMode: 'repitch',
        originalTempo: 120,
        markers: [{ id: 'warp-group', originalBeat: 3, warpedBeat: 3 }],
    });
    midiStore.set({
        probabilitySeed: 1,
        notesByClipId: { 'clip-a': [{ id: 'group-note', pitch: 60, startBeat: 1, duration: 2, velocity: 100 }] },
        ccByClipId: { 'clip-a': [{ id: 'group-cc', controller: 64, value: 127, beat: 3, channel: 1 }] },
        pitchBendByClipId: { 'clip-a': [{ id: 'group-pb', value: 200, beat: 3, channel: 1 }] },
    });
    flushAutomergeStorageWrites();
    trackStore.set({ ...trackStore.value!, selectedTrackId: null });
    const originalOwners = ownerProjections();
    await executeAppAction(
        { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' } },
        { source: 'manual', groupId: 'split-remove-probe' }
    );
    await executeAppAction(
        { type: 'removeClip', payload: { clipId: 'clip-right' } },
        { source: 'manual', groupId: 'split-remove-probe' }
    );
    await vi.waitFor(() =>
        expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(2)
    );
    const removedRaw = structuredClone(getCrdtDoc('root'));
    const removedOwners = ownerProjections();
    reloadSavedProject();
    return { originalOwners, removedRaw, removedOwners };
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
        agentProjectInspectionPort.setProvider(null);
        productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        clearHandlerRegistry();
        takeLaneStore.set({ lanes: [] });
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
        reloadSavedProject();
        const removedRaw = structuredClone(getCrdtDoc('root'));
        const removedOwners = ownerProjections();
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

    it('replays a saved sequential ripple group through restored automation and shared shifted owners', async () => {
        await persistSequentialRippleGroup();
        for (let round = 0; round < 2; round += 1) {
            expect((await undo()).headConsumed).toBe(true);
            expect(clipOnTrack(TRACK_ID, 'clip-c')).toMatchObject({ startBeat: 4.125, endBeat: 8.125 });
            expect(clipOnTrack(TRACK_ID, 'clip-b')).toMatchObject({ startBeat: 8.125, endBeat: 12.125 });
            expect(
                automationStore.value?.lanes.find((lane) => lane.id === 'restored-prefix-lane')?.points[0]?.beat
            ).toBe(4.625);
            expect(
                automationStore.value?.lanes.find((lane) => lane.id === 'shared-shifted-lane')?.points[0]?.beat
            ).toBe(8.625);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(2)
            );
            reloadSavedProject();
            await redo();
            expect(clipOnTrack(TRACK_ID, 'clip-b')).toMatchObject({ startBeat: 0.125, endBeat: 4.125 });
            expect(automationStore.value?.lanes.find((lane) => lane.id === 'restored-prefix-lane')).toBeUndefined();
            expect(
                automationStore.value?.lanes.find((lane) => lane.id === 'shared-shifted-lane')?.points[0]?.beat
            ).toBe(0.625);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(2)
            );
            reloadSavedProject();
        }
    });

    it('projects the full lane restored by a non-ripple sibling before an earlier ripple inverse', async () => {
        await persistSequentialRippleGroup(false);
        expect((await undo()).headConsumed).toBe(true);
        expect(clipOnTrack(TRACK_ID, 'clip-c')).toMatchObject({ startBeat: 4.125, endBeat: 8.125 });
        expect(
            automationStore.value?.lanes.find((lane) => lane.id === 'restored-prefix-lane')?.points[0]
        ).toMatchObject({ beat: 4.625, value: 0.3 });
        expect(clipOnTrack(TRACK_ID, 'clip-b')).toMatchObject({ startBeat: 8.125, endBeat: 12.125 });
    });

    it('four repairs: grouped split then remove replays only its completed prefix', async () => {
        const { originalOwners, removedRaw, removedOwners } = await persistSplitRemoveGroup();
        reloadSavedProject();
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        expect((await undo()).headConsumed).toBe(true);
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ startBeat: 0, endBeat: 4 });
        expect(clipOnTrack(TRACK_ID, 'clip-right')).toBeUndefined();
        expect(ownerProjections()).toEqual(originalOwners);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(2)
        );
        reloadSavedProject();
        await redo();
        expect(undoHistoryStore.value?.future).toEqual([]);
        expect(getCrdtDoc('root')).toEqual(removedRaw);
        expect(ownerProjections()).toEqual(removedOwners);
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ endBeat: 2 });
        expect(clipOnTrack(TRACK_ID, 'clip-right')).toBeUndefined();
    });

    it.each(['clipSatellites', 'clipAutomationLanes'] as const)(
        'refuses a hydrated grouped split whose pre-split %s guard is missing',
        async (field) => {
            workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
            const otherTrack = createTrack({ id: 'other-track', name: 'Other track', kind: 'midi' });
            otherTrack.clips = [{ ...createClipFixture('clip-c', 8, 12), trackId: otherTrack.id }];
            trackStore.set({ ...trackStore.value!, tracks: [...trackStore.value!.tracks, otherTrack] });
            prepareAutomationMove();
            setEnvelope('clip-a', {
                clipId: 'clip-a',
                enabled: true,
                points: [{ id: 'captured-gain', beatOffset: 1, gainDb: -6 }],
            });
            flushAutomergeStorageWrites();
            await executeAppAction(
                { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' } },
                { source: 'manual', groupId: 'split-peer-guard' }
            );
            await executeAppAction(
                { type: 'removeClip', payload: { clipId: 'clip-c' } },
                { source: 'manual', groupId: 'split-peer-guard' }
            );
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(2)
            );
            reloadSavedProject();
            expect((await undo()).headConsumed).toBe(true);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(2)
            );

            const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            if (!Array.isArray(saved.future)) {
                throw new TypeError('Expected saved grouped future');
            }
            const splitEntry = saved.future.find(
                (entry) => isRecord(entry) && isRecord(entry.action) && entry.action.type === 'splitClip'
            );
            delete savedSplitSnapshot(splitEntry, 'inverseAction', 'replacement')[field];
            delete savedSplitSnapshot(splitEntry, 'redoAction', 'expected')[field];
            sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
            reloadSavedProject();
            expect(undoHistoryStore.value?.future).toHaveLength(0);

            setEnvelope('clip-a', {
                clipId: 'clip-a',
                enabled: true,
                points: [{ id: 'peer-gain', beatOffset: 1, gainDb: -42 }],
            });
            flushAutomergeStorageWrites();
            await expectReplayRefused('redo');
        }
    );

    it('four repairs: never borrows a later group sibling to satisfy an absent split fragment', async () => {
        await persistSplitRemoveGroup();
        const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        if (!Array.isArray(saved.past)) {
            throw new TypeError('Expected saved split/remove entries');
        }
        saved.past.reverse();
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
        reloadSavedProject();
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        await expectReplayRefused('undo');
    });

    it.each(['geometry', 'midi', 'gain', 'warp'] as const)(
        'four repairs: completed split/remove prefix preserves refusal after peer %s edits',
        async (change) => {
            await persistSplitRemoveGroup();
            syncPeerProject((project) => {
                if (change === 'geometry') {
                    project.tracks.tracks[0]!.clips[0]!.endBeat = 1.9;
                }
                if (change === 'midi') {
                    project.midi.notesByClipId['clip-a']![0]!.velocity = 42;
                }
                if (change === 'gain') {
                    project.gainEnvelopes.envelopes['clip-a']!.points[0]!.gainDb = -42;
                }
                if (change === 'warp') {
                    project.warpStates.states['clip-a']!.originalTempo = 123;
                }
            });
            reloadSavedProject();
            expect(undoHistoryStore.value?.past).toHaveLength(2);
            await expectReplayRefused('undo');
        }
    );

    it('four repairs: split/remove replay preserves a peer edit on the surviving left automation lane', async () => {
        await persistSplitRemoveGroup();
        syncPeerProject((project) => {
            project.automation.lanes.find((lane) => lane.clipId === 'clip-a')!.points[0]!.value = 0.42;
        });
        reloadSavedProject();
        const editedLanes = structuredClone(automationStore.value!.lanes.filter((lane) => lane.clipId === 'clip-a'));
        expect((await undo()).headConsumed).toBe(true);
        expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ startBeat: 0, endBeat: 4 });
        expect(automationStore.value!.lanes.filter((lane) => lane.clipId === 'clip-a')).toEqual(editedLanes);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(2)
        );
        reloadSavedProject();
        await redo();
        expect(automationStore.value!.lanes.filter((lane) => lane.clipId === 'clip-a')).toEqual(editedLanes);
    });

    it('refuses duplicated restored lane identities across a saved sequential ripple group before writes', async () => {
        await persistSequentialRippleGroup();
        const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        if (!Array.isArray(saved.past)) {
            throw new TypeError('Expected saved sequential ripple history');
        }
        const entry = saved.past[0];
        if (
            !isRecord(entry) ||
            !isRecord(entry.inverseAction) ||
            !isRecord(entry.inverseAction.payload) ||
            !isRecord(entry.inverseAction.payload.ripplePlan)
        ) {
            throw new TypeError('Expected first removed clip capture');
        }
        const lanes = entry.inverseAction.payload.ripplePlan.clipAutomationLanes;
        if (!Array.isArray(lanes) || !isRecord(lanes[0])) {
            throw new TypeError('Expected captured removed lane');
        }
        lanes[0].id = 'restored-prefix-lane';
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
        reloadSavedProject();
        expect(undoHistoryStore.value?.past).toHaveLength(2);
        await expectReplayRefused('undo');
    });

    it.each(['geometry', 'automation'] as const)(
        'refuses a peer %s change across a saved sequential ripple group without partial writes',
        async (change) => {
            await persistSequentialRippleGroup();
            syncPeerProject((project) => {
                if (change === 'geometry') {
                    const clip = project.tracks.tracks[0]?.clips.find((row) => row.id === 'clip-b');
                    if (!clip) {
                        throw new Error('Expected shared shifted clip');
                    }
                    clip.startBeat = 1.125;
                    clip.endBeat = 5.125;
                } else {
                    const point = project.automation.lanes.find((lane) => lane.id === 'shared-shifted-lane')?.points[0];
                    if (!point) {
                        throw new Error('Expected shared shifted automation');
                    }
                    point.value = 0.9;
                }
            });
            await expectReplayRefused('undo');
        }
    );

    it('four repairs: impossible saved ripple capture cannot shift a later peer clip', async () => {
        await persistRippleRemoval(false);
        syncPeerProject((project) => {
            const track = project.tracks.tracks.find((row) => row.id === TRACK_ID);
            if (!track) {
                throw new Error('Expected track');
            }
            track.clips.push(createClipFixture('peer-later', 10, 12));
        });
        const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        if (!Array.isArray(saved.past) || !isRecord(saved.past[0])) {
            throw new Error('Expected saved history');
        }
        const inverse = saved.past[0].inverseAction;
        if (!isRecord(inverse) || !isRecord(inverse.payload) || !isRecord(inverse.payload.ripplePlan)) {
            throw new Error('Expected ripple plan');
        }
        const shifts = inverse.payload.ripplePlan.shiftedClips;
        if (!Array.isArray(shifts)) {
            throw new TypeError('Expected shifts');
        }
        shifts.push({
            clipId: 'peer-later',
            origStartBeat: 11,
            origEndBeat: 13,
            automationDelta: -1,
            expectedAutomationLanes: [],
        });
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
        const beforeRaw = structuredClone(getCrdtDoc('root'));
        const beforeHeads = Automerge.getHeads(getCrdtDoc('root')!);
        reloadSavedProject();
        expect(getCrdtDoc('root')).toEqual(beforeRaw);
        expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(beforeHeads);
        expect(undoHistoryStore.value?.past).toHaveLength(0);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toEqual([])
        );
        const mirror = sessionStorage.getItem(UNDO_SESSION_KEY);
        await expectReplayRefused('undo');
        expect(sessionStorage.getItem(UNDO_SESSION_KEY)).toBe(mirror);
        expect.soft(undoHistoryStore.value?.past).toHaveLength(0);
        expect.soft(clipOnTrack(TRACK_ID, 'peer-later')).toMatchObject({ startBeat: 10, endBeat: 12 });
        const raw = getCrdtDoc<{ tracks: { tracks: { clips: Clip[] }[] } }>('root');
        expect.soft(raw?.tracks.tracks[0]?.clips.find((clip) => clip.id === 'peer-later')).toMatchObject({
            startBeat: 10,
            endBeat: 12,
        });
    });

    describe.each([false, true])('saved ripple shifted-owner freshness with grouped=%s', (grouped) => {
        it.each([
            'geometry',
            'track',
            'deleted-clip',
            'point',
            'deleted-lane',
            'clip-owner',
            'track-owner',
            'added-lane',
        ] as const)('refuses a synced shifted %s edit before every replay write', async (change) => {
            await persistRippleRemoval(grouped);
            syncPeerProject((project) => {
                const track = project.tracks.tracks.find((row) => row.id === TRACK_ID);
                const otherTrack = project.tracks.tracks.find((row) => row.id === 'other-track');
                const clip = track?.clips.find((row) => row.id === 'clip-b');
                const lane = project.automation.lanes.find((row) => row.id === 'shifted-lane');
                if (!track || !otherTrack || !clip || !lane) {
                    throw new Error('Expected genuine ripple-shifted owners');
                }
                if (change === 'geometry') {
                    clip.startBeat = 1;
                    clip.endBeat = 5;
                } else if (change === 'track') {
                    track.clips = track.clips.filter((row) => row.id !== clip.id);
                    otherTrack.clips.push({ ...clip, trackId: otherTrack.id });
                } else if (change === 'deleted-clip') {
                    track.clips = track.clips.filter((row) => row.id !== clip.id);
                    project.automation.lanes = project.automation.lanes.filter((row) => row.clipId !== clip.id);
                } else if (change === 'point') {
                    lane.points[0]!.beat = 0.75;
                    lane.points[0]!.value = 0.9;
                } else if (change === 'deleted-lane') {
                    project.automation.lanes = project.automation.lanes.filter((row) => row.id !== lane.id);
                } else if (change === 'clip-owner') {
                    lane.clipId = 'peer-clip';
                    lane.trackId = otherTrack.id;
                } else if (change === 'track-owner') {
                    lane.trackId = otherTrack.id;
                } else {
                    project.automation.lanes.push(automationLane('peer-added-shifted-lane', clip.id));
                }
            });
            await expectReplayRefused('undo');
        });

        it('round trips a genuine fractional automated ripple while preserving unrelated peer material', async () => {
            await persistRippleRemoval(grouped, true, true);
            syncPeerProject((project) => {
                const otherTrack = project.tracks.tracks.find((row) => row.id === 'other-track');
                const peerClip = otherTrack?.clips.find((row) => row.id === 'peer-clip');
                if (!otherTrack || !peerClip) {
                    throw new Error('Expected unrelated peer clip');
                }
                peerClip.name = 'Peer phrase';
                const lane = automationLane('peer-unrelated-lane', peerClip.id);
                project.automation.lanes.push({ ...lane, trackId: otherTrack.id });
            });
            trackStore.set({
                ...trackStore.value!,
                selectedTrackId: 'other-track',
                ghostClips: [createClipFixture('local-ghost', 9, 10)],
            });
            const removedRaw = structuredClone(getCrdtDoc('root'));
            const peerLane = structuredClone(
                automationStore.value?.lanes.find((row) => row.id === 'peer-unrelated-lane')
            );
            for (let round = 0; round < 2; round += 1) {
                expect((await undo()).headConsumed).toBe(true);
                expect(clipOnTrack(TRACK_ID, 'clip-b')).toMatchObject({ startBeat: 4.125, endBeat: 8.125 });
                expect(
                    automationStore.value?.lanes
                        .find((row) => row.id === 'shifted-lane')
                        ?.points.map((point) => point.beat)
                ).toEqual([4.625, 7.625]);
                expect(clipOnTrack('other-track', 'peer-clip')?.name).toBe('Peer phrase');
                expect(automationStore.value?.lanes.find((row) => row.id === 'peer-unrelated-lane')).toEqual(peerLane);
                expect(trackStore.value?.selectedTrackId).toBe('other-track');
                expect(trackStore.value?.ghostClips).toEqual([createClipFixture('local-ghost', 9, 10)]);
                await vi.waitFor(() =>
                    expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(
                        grouped ? 2 : 1
                    )
                );
                if (round === 1) {
                    reloadSavedProject();
                }
                await redo();
                expect(getCrdtDoc('root')).toEqual(removedRaw);
                await vi.waitFor(() =>
                    expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(
                        grouped ? 2 : 1
                    )
                );
                if (round === 0) {
                    reloadSavedProject();
                    trackStore.set({
                        ...trackStore.value!,
                        selectedTrackId: 'other-track',
                        ghostClips: [createClipFixture('local-ghost', 9, 10)],
                    });
                }
            }
        });

        it.each([false, true])(
            'reads historical absent automation captures and authenticates an empty scope=%s',
            async (empty) => {
                await persistRippleRemoval(grouped, !empty);
                const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
                if (!Array.isArray(saved.past)) {
                    throw new TypeError('Expected saved ripple history');
                }
                for (const entry of saved.past) {
                    if (
                        !isRecord(entry) ||
                        !isRecord(entry.inverseAction) ||
                        !isRecord(entry.inverseAction.payload) ||
                        !isRecord(entry.inverseAction.payload.ripplePlan) ||
                        !Array.isArray(entry.inverseAction.payload.ripplePlan.shiftedClips)
                    ) {
                        throw new TypeError('Expected saved shifted captures');
                    }
                    for (const shifted of entry.inverseAction.payload.ripplePlan.shiftedClips) {
                        if (!isRecord(shifted)) {
                            throw new TypeError('Expected saved shifted row');
                        }
                        delete shifted.expectedAutomationLanes;
                    }
                }
                sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
                reloadSavedProject();
                expect(undoHistoryStore.value?.past).toHaveLength(grouped ? 2 : 1);
                if (empty) {
                    expect((await undo()).headConsumed).toBe(true);
                    expect(clipOnTrack(TRACK_ID, 'clip-b')).toMatchObject({ startBeat: 4, endBeat: 8 });
                    await redo();
                    expect(clipOnTrack(TRACK_ID, 'clip-b')).toMatchObject({ startBeat: 0, endBeat: 4 });
                } else {
                    await expectReplayRefused('undo');
                }
            }
        );

        it('refreshes the saved automated ripple capture for the actual Redo before the next Undo', async () => {
            await persistRippleRemoval(grouped, true, true);
            expect((await undo()).headConsumed).toBe(true);
            syncPeerProject((project) => {
                const lane = project.automation.lanes.find((row) => row.id === 'shifted-lane');
                if (!lane) {
                    throw new Error('Expected restored automation owner');
                }
                lane.points[0]!.beat = 4.875;
                lane.points[0]!.value = 0.9;
            });
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(
                    grouped ? 2 : 1
                )
            );
            reloadSavedProject();
            await redo();
            expect(automationStore.value?.lanes.find((row) => row.id === 'shifted-lane')?.points[0]).toMatchObject({
                beat: 0.875,
                value: 0.9,
            });
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(
                    grouped ? 2 : 1
                )
            );
            reloadSavedProject();
            expect((await undo()).headConsumed).toBe(true);
            expect(automationStore.value?.lanes.find((row) => row.id === 'shifted-lane')?.points[0]).toMatchObject({
                beat: 4.875,
                value: 0.9,
            });
            expect(clipOnTrack(TRACK_ID, 'clip-b')).toMatchObject({ startBeat: 4.125, endBeat: 8.125 });
        });

        it.each(['foreign-track', 'unsupported-curve', 'duplicate-shift', 'unknown-field'] as const)(
            'rejects a genuine saved shifted capture changed to %s before hydration writes',
            async (corruption) => {
                await persistRippleRemoval(grouped);
                const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
                if (!Array.isArray(saved.past)) {
                    throw new TypeError('Expected saved ripple entry');
                }
                const entry = saved.past.find(
                    (candidate) =>
                        isRecord(candidate) &&
                        isRecord(candidate.action) &&
                        isRecord(candidate.action.payload) &&
                        candidate.action.payload.clipId === 'clip-a'
                );
                if (
                    !isRecord(entry) ||
                    !isRecord(entry.inverseAction) ||
                    !isRecord(entry.inverseAction.payload) ||
                    !isRecord(entry.inverseAction.payload.ripplePlan)
                ) {
                    throw new TypeError('Expected genuine captured ripple plan');
                }
                const plan = entry.inverseAction.payload.ripplePlan;
                if (!Array.isArray(plan.shiftedClips) || !isRecord(plan.shiftedClips[0])) {
                    throw new TypeError('Expected genuine shifted clip');
                }
                const shifted = plan.shiftedClips[0];
                if (!Array.isArray(shifted.expectedAutomationLanes) || !isRecord(shifted.expectedAutomationLanes[0])) {
                    throw new TypeError('Expected genuine shifted automation capture');
                }
                if (corruption === 'foreign-track') {
                    shifted.expectedAutomationLanes[0].trackId = 'other-track';
                } else if (corruption === 'unsupported-curve') {
                    const points = shifted.expectedAutomationLanes[0].points;
                    if (!Array.isArray(points) || !isRecord(points[0])) {
                        throw new TypeError('Expected captured automation point');
                    }
                    points[0].curve = 'unsupported';
                } else if (corruption === 'duplicate-shift') {
                    plan.shiftedClips.push(structuredClone(shifted));
                } else {
                    shifted.unrecordedOwner = 'peer-clip';
                }
                sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
                const raw = structuredClone(getCrdtDoc('root'));
                reloadSavedProject();
                expect(undoHistoryStore.value?.past).toEqual([]);
                expect(getCrdtDoc('root')).toEqual(raw);
                await expectReplayRefused('undo');
            }
        );
    });

    describe.each([false, true])('saved removal owner freshness with grouped=%s', (grouped) => {
        it.each([0, 1])(
            'rejects a foreign automation track owner in captured lane %s before hydration and Undo',
            async (laneIndex) => {
                const { saved, plan } = await persistRemovalWithDistinctOwners(grouped);
                const otherTrack = createTrack({ id: 'other-track', name: 'Other track', kind: 'midi' });
                trackStore.set({ ...trackStore.value!, tracks: [...trackStore.value!.tracks, otherTrack] });
                if (!Array.isArray(plan.clipAutomationLanes) || !isRecord(plan.clipAutomationLanes[laneIndex])) {
                    throw new Error('Expected a captured removal automation lane');
                }
                expect(plan.clipAutomationLanes[laneIndex].trackId).toBe(TRACK_ID);
                plan.clipAutomationLanes[laneIndex].trackId = otherTrack.id;
                sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));

                reloadSavedProject();
                expect(undoHistoryStore.value?.past).toEqual([]);
                expect(undoHistoryStore.value?.future).toEqual([]);
                const beforeRaw = structuredClone(getCrdtDoc('root'));
                const beforeHeads = Automerge.getHeads(getCrdtDoc('root')!);
                const beforeOwners = ownerProjections();
                const beforeHistory = structuredClone(undoHistoryStore.value);

                expect((await undo()).headConsumed).toBe(false);
                expect(getCrdtDoc('root')).toEqual(beforeRaw);
                expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(beforeHeads);
                projectCrdtToStores({ resetProjections: true });
                expect(ownerProjections()).toEqual(beforeOwners);
                expect(undoHistoryStore.value).toEqual(beforeHistory);
                expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
                if (grouped) {
                    expect(clipOnTrack(TRACK_ID, 'clip-c')).toBeUndefined();
                }
            }
        );

        it('refuses a later clip identity recreated by a synced peer on another track before any replay write', async () => {
            await persistRemovalWithDistinctOwners(grouped);
            reloadSavedProject();
            expect(undoHistoryStore.value?.past).toHaveLength(grouped ? 2 : 1);
            const peerTrack = createTrack({ id: 'peer-track', name: 'Peer track', kind: 'midi' });
            const peerClip = {
                ...createClipFixture('clip-a', 12.5, 16.75),
                trackId: peerTrack.id,
                name: 'Peer recreation',
            };
            peerTrack.clips = [peerClip];
            syncPeerProject((project) => {
                project.tracks.tracks.push(peerTrack);
            });
            expect(clipOnTrack(peerTrack.id, 'clip-a')).toEqual(peerClip);
            expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
            const beforeRaw = structuredClone(getCrdtDoc('root'));
            const beforeHeads = Automerge.getHeads(getCrdtDoc('root')!);
            const beforeOwners = ownerProjections();
            const beforeHistory = structuredClone(undoHistoryStore.value);
            const writes = [
                vi.spyOn(trackStore, 'set'),
                vi.spyOn(midiStore, 'set'),
                vi.spyOn(gainEnvelopeStore, 'set'),
                vi.spyOn(warpStateStore, 'set'),
                vi.spyOn(automationStore, 'set'),
                vi.spyOn(takeLaneStore, 'set'),
                vi.spyOn(undoHistoryStore, 'set'),
            ];
            try {
                expect((await undo()).headConsumed).toBe(false);
                expect(getCrdtDoc('root')).toEqual(beforeRaw);
                expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(beforeHeads);
                expect(ownerProjections()).toEqual(beforeOwners);
                expect(undoHistoryStore.value).toEqual(beforeHistory);
                expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
                if (grouped) {
                    expect(clipOnTrack(TRACK_ID, 'clip-c')).toBeUndefined();
                }
                for (const write of writes) {
                    expect(write).not.toHaveBeenCalled();
                }
            } finally {
                for (const write of writes) {
                    write.mockRestore();
                }
            }
            projectCrdtToStores({ resetProjections: true });
            expect(ownerProjections()).toEqual(beforeOwners);
            expect(clipOnTrack(peerTrack.id, 'clip-a')).toEqual(peerClip);
        });

        it('restores captured target owners while keeping later peer owners and current selection and ghosts', async () => {
            midiStore.set({
                probabilitySeed: 1,
                notesByClipId: {
                    'clip-a': [{ id: 'captured-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
                },
                ccByClipId: { 'clip-a': [{ id: 'captured-cc', controller: 1, value: 20, beat: 0, channel: 1 }] },
                pitchBendByClipId: { 'clip-a': [{ id: 'captured-pb', value: 0.2, beat: 0, channel: 1 }] },
            });
            const { original } = await persistRemovalWithDistinctOwners(grouped);
            reloadSavedProject();
            const peer = createTrack({ id: 'peer-track', name: 'Peer track', kind: 'audio' });
            const ghost = { ...createClipFixture('current-ghost', 16, 20), isGhost: true };
            trackStore.set({
                ...trackStore.value!,
                tracks: [...trackStore.value!.tracks, peer],
                selectedTrackId: peer.id,
                ghostClips: [ghost],
            });
            midiStore.set({
                ...midiStore.value!,
                notesByClipId: {
                    ...midiStore.value!.notesByClipId,
                    'clip-b': [{ id: 'peer-note', pitch: 67, startBeat: 1, duration: 0.5, velocity: 79 }],
                },
            });
            setEnvelope('clip-b', {
                clipId: 'clip-b',
                enabled: true,
                points: [{ id: 'peer-gain', beatOffset: 0, gainDb: -12 }],
            });
            setWarpState('clip-b', {
                enabled: true,
                markers: [{ id: 'peer-warp', originalBeat: 0, warpedBeat: 2 }],
                stretchMode: 'repitch',
                originalTempo: 120,
            });
            const peerAutomation = automationStore.value!.lanes.map((lane) => ({ ...lane, enabled: false }));
            automationStore.set({ lanes: peerAutomation });
            flushAutomergeStorageWrites();
            const removedRaw = structuredClone(getCrdtDoc('root'));
            const removedOwners = ownerProjections();
            for (let round = 0; round < 2; round += 1) {
                expect((await undo()).headConsumed).toBe(true);
                expect(clipOnTrack(TRACK_ID, 'clip-a')).toEqual(original.tracks!.tracks[0]!.clips[0]);
                expect(gainEnvelopeStore.value?.envelopes['clip-a']).toEqual(original.gain?.envelopes['clip-a']);
                expect(warpStateStore.value?.states['clip-a']).toEqual(original.warp?.states['clip-a']);
                expect(midiStore.value?.notesByClipId['clip-a']).toEqual(original.midi?.notesByClipId['clip-a']);
                expect(midiStore.value?.ccByClipId['clip-a']).toEqual(original.midi?.ccByClipId['clip-a']);
                expect(midiStore.value?.pitchBendByClipId['clip-a']).toEqual(
                    original.midi?.pitchBendByClipId['clip-a']
                );
                expect(midiStore.value?.notesByClipId['clip-b']).toEqual(removedOwners.midi?.notesByClipId['clip-b']);
                expect(gainEnvelopeStore.value?.envelopes['clip-b']).toEqual(removedOwners.gain?.envelopes['clip-b']);
                expect(warpStateStore.value?.states['clip-b']).toEqual(removedOwners.warp?.states['clip-b']);
                expect(automationStore.value?.lanes).toEqual([
                    ...peerAutomation,
                    ...original.automation!.lanes.slice(0, 2),
                ]);
                expect(trackStore.value?.selectedTrackId).toBe(peer.id);
                expect(trackStore.value?.ghostClips).toEqual([ghost]);
                expect(getCrdtDoc('root')).toMatchObject({
                    midi: midiStore.value,
                    gainEnvelopes: gainEnvelopeStore.value,
                    warpStates: warpStateStore.value,
                    automation: automationStore.value,
                });
                expect(undoHistoryStore.value?.past).toEqual([]);
                expect(undoHistoryStore.value?.future).toHaveLength(grouped ? 2 : 1);
                await redo();
                expect(getCrdtDoc('root')).toEqual(removedRaw);
                expect(ownerProjections()).toEqual(removedOwners);
                expect(undoHistoryStore.value?.past).toHaveLength(grouped ? 2 : 1);
                expect(undoHistoryStore.value?.future).toEqual([]);
            }
        });

        it.each(['notes', 'controlChanges', 'pitchBends', 'gain', 'warp', 'automation'] as const)(
            'refuses later target %s before any replay write and keeps the history pending',
            async (owner) => {
                midiStore.set({
                    probabilitySeed: 1,
                    notesByClipId: {
                        'clip-a': [{ id: 'captured-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
                    },
                    ccByClipId: { 'clip-a': [{ id: 'captured-cc', controller: 1, value: 20, beat: 0, channel: 1 }] },
                    pitchBendByClipId: { 'clip-a': [{ id: 'captured-pb', value: 0.2, beat: 0, channel: 1 }] },
                });
                await persistRemovalWithDistinctOwners(grouped);
                hydrateProductionContracts();
                expect(undoHistoryStore.value?.past).toHaveLength(grouped ? 2 : 1);

                const midi = midiStore.value!;
                if (owner === 'notes') {
                    midiStore.set({
                        ...midi,
                        notesByClipId: {
                            ...midi.notesByClipId,
                            'clip-a': [{ id: 'later-note', pitch: 64, startBeat: 0, duration: 1, velocity: 75 }],
                        },
                    });
                } else if (owner === 'controlChanges') {
                    midiStore.set({
                        ...midi,
                        ccByClipId: {
                            ...midi.ccByClipId,
                            'clip-a': [{ id: 'later-cc', controller: 1, value: 75, beat: 0, channel: 1 }],
                        },
                    });
                } else if (owner === 'pitchBends') {
                    midiStore.set({
                        ...midi,
                        pitchBendByClipId: {
                            ...midi.pitchBendByClipId,
                            'clip-a': [{ id: 'later-pb', value: 0.75, beat: 0, channel: 1 }],
                        },
                    });
                } else if (owner === 'gain') {
                    setEnvelope('clip-a', {
                        clipId: 'clip-a',
                        enabled: true,
                        points: [{ id: 'later-gain', beatOffset: 0, gainDb: -3 }],
                    });
                } else if (owner === 'warp') {
                    setWarpState('clip-a', {
                        enabled: true,
                        markers: [{ id: 'later-warp', originalBeat: 0, warpedBeat: 1 }],
                        stretchMode: 'repitch',
                        originalTempo: 120,
                    });
                } else {
                    automationStore.set({
                        lanes: [...automationStore.value!.lanes, automationLane('later-lane', 'clip-a')],
                    });
                }
                flushAutomergeStorageWrites();
                const beforeRaw = structuredClone(getCrdtDoc('root'));
                const beforeHeads = Automerge.getHeads(getCrdtDoc('root')!);
                const beforeOwners = ownerProjections();
                const beforeHistory = structuredClone(undoHistoryStore.value);
                const writes = [
                    vi.spyOn(trackStore, 'set'),
                    vi.spyOn(midiStore, 'set'),
                    vi.spyOn(gainEnvelopeStore, 'set'),
                    vi.spyOn(warpStateStore, 'set'),
                    vi.spyOn(automationStore, 'set'),
                    vi.spyOn(takeLaneStore, 'set'),
                    vi.spyOn(undoHistoryStore, 'set'),
                ];
                try {
                    expect((await undo()).headConsumed).toBe(false);
                    expect(getCrdtDoc('root')).toEqual(beforeRaw);
                    expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(beforeHeads);
                    expect(ownerProjections()).toEqual(beforeOwners);
                    expect(undoHistoryStore.value).toEqual(beforeHistory);
                    expect(clipOnTrack(TRACK_ID, 'clip-a')).toBeUndefined();
                    if (grouped) {
                        expect(clipOnTrack(TRACK_ID, 'clip-c')).toBeUndefined();
                    }
                    for (const write of writes) {
                        expect(write).not.toHaveBeenCalled();
                    }
                } finally {
                    for (const write of writes) {
                        write.mockRestore();
                    }
                }
            }
        );
    });

    it('rejects duplicate MIDI note identities in a persisted removeClip capture before hydration and Undo', async () => {
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'clip-a': [{ id: 'captured-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushAutomergeStorageWrites();
        await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
        );

        const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        if (!Array.isArray(persisted.past)) {
            throw new TypeError('Expected saved removal entries');
        }
        const entry = persisted.past[0];
        if (!isRecord(entry) || !isRecord(entry.inverseAction) || !isRecord(entry.inverseAction.payload)) {
            throw new Error('Expected saved removal inverse');
        }
        const snapshot = entry.inverseAction.payload.midiNotesSnapshot;
        if (!Array.isArray(snapshot) || !isRecord(snapshot[0])) {
            throw new Error('Expected captured MIDI note');
        }
        expect(snapshot).toHaveLength(1);
        snapshot.push({ ...snapshot[0], pitch: 61 });
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(persisted));

        hydrateProductionContracts();
        const hydratedPast = undoHistoryStore.value?.past.length;
        const undoResult = await undo();
        const rawNotes = getCrdtDoc<{
            midi: { notesByClipId: Record<string, { id: string; pitch: number }[]> };
        }>('root')?.midi.notesByClipId['clip-a'];
        const observed = {
            hydratedPast,
            undoResult,
            clipRestored: clipOnTrack(TRACK_ID, 'clip-a') !== undefined,
            projectedNotes: midiStore.value?.notesByClipId['clip-a']?.map(({ id, pitch }) => ({ id, pitch })),
            rawNotes: rawNotes?.map(({ id, pitch }) => ({ id, pitch })),
            historyPast: undoHistoryStore.value?.past.length,
            historyFuture: undoHistoryStore.value?.future.length,
        };
        expect(observed).toEqual({
            hydratedPast: 0,
            undoResult: { headConsumed: false },
            clipRestored: false,
            projectedNotes: undefined,
            rawNotes: undefined,
            historyPast: 0,
            historyFuture: 0,
        });
    });

    describe.each(['midiNotesSnapshot', 'midiCcSnapshot', 'midiPitchBendSnapshot'] as const)(
        'saved restoreClip %s owner admission',
        (field) => {
            it.each(['malformed', 'missing', 'duplicate'] as const)(
                'drops a %s required capture before hydration or Undo writes',
                async (corruption) => {
                    midiStore.set({
                        probabilitySeed: 1,
                        notesByClipId: {
                            'clip-a': [{ id: 'note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
                        },
                        ccByClipId: { 'clip-a': [{ id: 'cc', controller: 1, value: 64, beat: 0.5, channel: 1 }] },
                        pitchBendByClipId: { 'clip-a': [{ id: 'pb', value: 256, beat: 0.75, channel: 1 }] },
                    });
                    flushAutomergeStorageWrites();
                    await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
                    await vi.waitFor(() =>
                        expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
                    );
                    const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
                    if (!Array.isArray(saved.past)) {
                        throw new TypeError('Expected saved removal entries');
                    }
                    const entry = saved.past[0];
                    if (!isRecord(entry) || !isRecord(entry.inverseAction) || !isRecord(entry.inverseAction.payload)) {
                        throw new Error('Expected saved removal inverse');
                    }
                    const payload = entry.inverseAction.payload;
                    if (corruption === 'missing') {
                        delete payload[field];
                    } else if (corruption === 'malformed') {
                        payload[field] = [{ id: 'incomplete-row' }];
                    } else {
                        const rows = payload[field];
                        if (!Array.isArray(rows) || !isRecord(rows[0])) {
                            throw new Error('Expected captured MIDI row');
                        }
                        rows.push({ ...rows[0] });
                    }
                    sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
                    reloadSavedProject();
                    expect(undoHistoryStore.value?.past).toEqual([]);
                    await expectReplayRefused('undo');
                }
            );
        }
    );

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

    it.each([false, true])(
        'split Redo refuses a right-fragment identity recreated by a synced peer on another track, grouped=%s',
        async (grouped) => {
            workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
            if (grouped) {
                const otherTrack = createTrack({ id: 'group-track', name: 'Group track', kind: 'midi' });
                otherTrack.clips = [{ ...createClipFixture('clip-c', 8, 12), trackId: otherTrack.id }];
                trackStore.set({ ...trackStore.value!, tracks: [...trackStore.value!.tracks, otherTrack] });
            }
            prepareAutomationMove();
            await executeAppAction(
                { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' } },
                { source: 'manual', groupId: grouped ? 'peer-split-group' : undefined }
            );
            if (grouped) {
                await executeAppAction(
                    { type: 'removeClip', payload: { clipId: 'clip-c' } },
                    { source: 'manual', groupId: 'peer-split-group' }
                );
            }
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(
                    grouped ? 2 : 1
                )
            );
            reloadSavedProject();
            expect((await undo()).headConsumed).toBe(true);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(
                    grouped ? 2 : 1
                )
            );
            reloadSavedProject();

            const peerTrack = createTrack({ id: 'peer-track', name: 'Peer track', kind: 'midi' });
            const peerClip = {
                ...createClipFixture('clip-right', 12.5, 16.75),
                trackId: peerTrack.id,
                name: 'Peer recreation',
            };
            peerTrack.clips = [peerClip];
            syncPeerProject((project) => {
                project.tracks.tracks.push(peerTrack);
            });
            expect(clipOnTrack(peerTrack.id, 'clip-right')).toEqual(peerClip);
            expect(clipOnTrack(TRACK_ID, 'clip-right')).toBeUndefined();

            const beforeRaw = structuredClone(getCrdtDoc('root'));
            const beforeHeads = Automerge.getHeads(getCrdtDoc('root')!);
            const beforeOwners = ownerProjections();
            const beforeHistory = structuredClone(undoHistoryStore.value);
            const writes = [
                vi.spyOn(trackStore, 'set'),
                vi.spyOn(midiStore, 'set'),
                vi.spyOn(gainEnvelopeStore, 'set'),
                vi.spyOn(warpStateStore, 'set'),
                vi.spyOn(automationStore, 'set'),
                vi.spyOn(takeLaneStore, 'set'),
                vi.spyOn(undoHistoryStore, 'set'),
            ];
            try {
                await redo();
                expect(getCrdtDoc('root')).toEqual(beforeRaw);
                expect(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(beforeHeads);
                expect(ownerProjections()).toEqual(beforeOwners);
                expect(undoHistoryStore.value).toEqual(beforeHistory);
                expect(clipOnTrack(TRACK_ID, 'clip-right')).toBeUndefined();
                for (const write of writes) {
                    expect(write).not.toHaveBeenCalled();
                }
            } finally {
                for (const write of writes) {
                    write.mockRestore();
                }
            }
            projectCrdtToStores({ resetProjections: true });
            expect(ownerProjections()).toEqual(beforeOwners);
            expect(clipOnTrack(peerTrack.id, 'clip-right')).toEqual(peerClip);
        }
    );

    describe.each([false, true])('saved take-lane identity owners with grouped=%s', (grouped) => {
        it.each([
            ['remove', 'saved-id'],
            ['remove', 'peer-id'],
            ['split', 'saved-id'],
            ['split', 'peer-id'],
        ] as const)(
            'refuses %s replay after a %s foreign lane collision before every owner write',
            async (operation, collision) => {
                workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
                const otherTrack = createTrack({ id: 'other-track', name: 'Other track', kind: 'midi' });
                otherTrack.clips = [{ ...createClipFixture('other-clip', 8, 12), trackId: otherTrack.id }];
                trackStore.set({ ...trackStore.value!, tracks: [...trackStore.value!.tracks, otherTrack] });
                const residentTake = { ...createTake('other-clip', 'Resident take', 8, 12), selected: true };
                const residentLane = {
                    ...createTakeLane(otherTrack.id),
                    id: 'resident-lane',
                    takes: [residentTake],
                    activeCompRegions: [{ startBeat: 8, endBeat: 12, takeId: residentTake.id }],
                };
                takeLaneStore.set({ lanes: [residentLane] });
                if (operation === 'remove') {
                    const removedTake = { ...createTake('clip-a', 'Removed take', 0, 4), selected: true };
                    takeLaneStore.set({
                        lanes: [
                            {
                                ...createTakeLane(TRACK_ID),
                                id: 'captured-lane',
                                takes: [removedTake],
                                activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: removedTake.id }],
                            },
                            residentLane,
                        ],
                    });
                    await persistRemovalWithDistinctOwners(grouped);
                } else {
                    automationStore.set({ lanes: [automationLane('source-lane', 'clip-a')] });
                    flushAutomergeStorageWrites();
                    stopProjectionBridge = setupProjectionBridge();
                    projectCrdtToStores();
                    const split = {
                        type: 'splitClip' as const,
                        payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' },
                    };
                    if (grouped) {
                        const result = await executeAppActionBatch(
                            [
                                split,
                                {
                                    type: 'splitClip',
                                    payload: { clipId: 'other-clip', beat: 10, rightClipId: 'other-right' },
                                },
                            ],
                            { source: 'manual', groupId: 'saved-split-group' }
                        );
                        expect(result.status).toBe('committed');
                    } else {
                        await executeAppAction(split, { source: 'manual' });
                    }
                    const rightTake = { ...createTake('clip-right', 'Later right take', 2, 4), selected: true };
                    syncPeerProject((project) => {
                        project.takeLanes.lanes.push({
                            ...createTakeLane(TRACK_ID),
                            id: 'captured-lane',
                            takes: [rightTake],
                            activeCompRegions: [{ startBeat: 2, endBeat: 4, takeId: rightTake.id }],
                        });
                    });
                    expect((await undo()).headConsumed).toBe(true);
                    expect(clipOnTrack(TRACK_ID, 'clip-right')).toBeUndefined();
                }
                const stack = operation === 'remove' ? 'past' : 'future';
                await vi.waitFor(() =>
                    expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY))[stack]).toHaveLength(
                        grouped ? 2 : 1
                    )
                );
                const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
                const entries = saved[stack];
                if (!Array.isArray(entries) || !isRecord(entries[0])) {
                    throw new Error('Expected real saved clip edit');
                }
                if (collision === 'saved-id') {
                    const actions: ('inverseAction' | 'redoAction')[] = ['inverseAction'];
                    if (operation === 'split') {
                        actions.push('redoAction');
                    }
                    for (const actionName of actions) {
                        const action = entries[0][actionName];
                        if (
                            !isRecord(action) ||
                            !isRecord(action.payload) ||
                            !Array.isArray(action.payload.retiredTakeLanes)
                        ) {
                            throw new Error('Expected captured retirement');
                        }
                        const capture = action.payload.retiredTakeLanes[0];
                        if (!isRecord(capture) || !isRecord(capture.lane)) {
                            throw new Error('Expected captured lane');
                        }
                        expect(capture.lane).toMatchObject({ id: 'captured-lane', trackId: TRACK_ID });
                        capture.lane.id = residentLane.id;
                    }
                    sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
                }
                reloadSavedProject();
                expect(undoHistoryStore.value?.[stack]).toHaveLength(grouped ? 2 : 1);
                if (collision === 'peer-id') {
                    syncPeerProject((project) => {
                        const foreignLane = project.takeLanes.lanes.find((lane) => lane.id === residentLane.id);
                        if (!foreignLane) {
                            throw new Error('Expected resident foreign lane');
                        }
                        foreignLane.id = 'captured-lane';
                    });
                }
                await expectReplayRefused(operation === 'remove' ? 'undo' : 'redo');
                expect(clipOnTrack(TRACK_ID, operation === 'remove' ? 'clip-a' : 'clip-right')).toBeUndefined();
            }
        );
    });

    it('merges saved removal takes into a new correct-track lane while preserving peer selection and disjoint comp material', async () => {
        const retired = { ...createTake('clip-a', 'Removed choice', 0, 4), selected: true };
        takeLaneStore.set({
            lanes: [
                {
                    id: 'captured-lane',
                    trackId: TRACK_ID,
                    takes: [retired],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: retired.id }],
                },
            ],
        });
        await persistRemovalWithDistinctOwners();
        reloadSavedProject();
        const later = { ...createTake('clip-b', 'Later choice', 4, 8), selected: true };
        syncPeerProject((project) => {
            project.takeLanes.lanes.push({
                id: 'new-correct-lane',
                trackId: TRACK_ID,
                takes: [later],
                activeCompRegions: [{ startBeat: 4.25, endBeat: 7.75, takeId: later.id }],
            });
        });
        expect((await undo()).headConsumed).toBe(true);
        const expected = [
            {
                id: 'new-correct-lane',
                trackId: TRACK_ID,
                takes: [{ ...retired, selected: false }, later],
                activeCompRegions: [
                    { startBeat: 0, endBeat: 4, takeId: retired.id },
                    { startBeat: 4.25, endBeat: 7.75, takeId: later.id },
                ],
            },
        ];
        expect(takeLaneStore.value?.lanes).toEqual(expected);
        expect(getCrdtDoc<{ takeLanes: { lanes: unknown[] } }>('root')?.takeLanes.lanes).toEqual(expected);
        expect(takeLaneStore.value?.lanes[0]?.takes.filter((take) => take.selected)).toEqual([later]);
    });

    it.each([false, true])(
        'removeClip retains placed audio pass fields or rejects a foreign retired lane owner=%s',
        async (foreignOwner) => {
            workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
            const audio: Clip = {
                ...createClipFixture('recorded-audio', 8, 16),
                type: 'audio',
                audioBufferId: 'recorded-loop-buffer',
                audioOffsetBeats: -4,
            };
            trackStore.set({
                tracks: [
                    TrackDummy.create({ id: TRACK_ID, kind: 'audio', clips: [audio] }),
                    createTrack({ id: 'other-track', name: 'Other track', kind: 'audio' }),
                ],
                selectedTrackId: TRACK_ID,
                ghostClips: [],
            });
            // A recording begun at beat 12 in loop [8, 16): the second pass
            // sounds before the media origin and reads two seconds into it.
            const placed = placeTakeOnClipMedia(
                { ...createTake(audio.id, 'Pass 2', 8, 16, 4), selected: true },
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
            if (foreignOwner) {
                const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
                if (
                    !Array.isArray(saved.past) ||
                    !isRecord(saved.past[0]) ||
                    !isRecord(saved.past[0].inverseAction) ||
                    !isRecord(saved.past[0].inverseAction.payload) ||
                    !Array.isArray(saved.past[0].inverseAction.payload.retiredTakeLanes)
                ) {
                    throw new Error('Expected saved placed removal capture');
                }
                const retired = saved.past[0].inverseAction.payload.retiredTakeLanes[0];
                if (!isRecord(retired) || !isRecord(retired.lane)) {
                    throw new Error('Expected saved placed lane');
                }
                retired.lane.trackId = 'other-track';
                sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
                const raw = structuredClone(getCrdtDoc('root'));
                const owners = ownerProjections();
                hydrateProductionContracts();
                expect(undoHistoryStore.value?.past).toEqual([]);
                const history = structuredClone(undoHistoryStore.value);
                expect((await undo()).headConsumed).toBe(false);
                expect(getCrdtDoc('root')).toEqual(raw);
                expect(ownerProjections()).toEqual(owners);
                expect(undoHistoryStore.value).toEqual(history);
                return;
            }
            reloadSavedProject();
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
        }
    );

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

    it.each(['expected', 'replacement'] as const)(
        'rejects a saved move whose %s automation owner disagrees with its placement',
        async (leg) => {
            trackStore.set({
                ...trackStore.value!,
                tracks: [
                    ...trackStore.value!.tracks,
                    createTrack({
                        id: 'unrelated-track',
                        name: 'Unrelated track',
                        kind: 'midi',
                        withoutDefaultDevice: true,
                    }),
                ],
            });
            prepareAutomationMove();
            await executeAppAction(
                { type: 'moveClip', payload: { clipId: 'clip-a', trackId: TRACK_ID, startBeat: 0.1 } },
                { source: 'manual' }
            );
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
            );
            const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
            if (!Array.isArray(saved.past) || !isRecord(saved.past[0])) {
                throw new Error('Expected saved move');
            }
            for (const [actionName, placementName] of [
                ['inverseAction', leg],
                ['redoAction', leg === 'expected' ? 'replacement' : 'expected'],
            ] as const) {
                const action = saved.past[0][actionName];
                if (!isRecord(action) || !isRecord(action.payload)) {
                    throw new Error('Expected saved move action');
                }
                const placement = action.payload[placementName];
                if (
                    !isRecord(placement) ||
                    !Array.isArray(placement.automationLanes) ||
                    !isRecord(placement.automationLanes[0])
                ) {
                    throw new Error('Expected saved move lane');
                }
                placement.automationLanes[0].trackId = 'unrelated-track';
            }
            sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
            const raw = structuredClone(getCrdtDoc('root'));
            const owners = ownerProjections();
            hydrateProductionContracts();
            expect(undoHistoryStore.value?.past).toEqual([]);
            const history = structuredClone(undoHistoryStore.value);
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toEqual(raw);
            expect(ownerProjections()).toEqual(owners);
            expect(undoHistoryStore.value).toEqual(history);
        }
    );

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

    describe.each(['undo', 'redo'] as const)('saved split optional owners before %s', (replay) => {
        it.each(['clip', 'track'] as const)(
            'rejects a paired right automation capture rebound to another %s',
            async (owner) => {
                const lanes = prepareAutomationMove();
                automationStore.set({ lanes: [...lanes, automationLane('unrelated-clip-lane', 'clip-b')] });
                flushAutomergeStorageWrites();
                await executeAppAction(
                    { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2.25, rightClipId: 'clip-right' } },
                    { source: 'manual' }
                );
                await vi.waitFor(() =>
                    expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
                );
                if (replay === 'redo') {
                    expect((await undo()).headConsumed).toBe(true);
                    await vi.waitFor(() =>
                        expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
                    );
                }
                const stack = replay === 'undo' ? 'past' : 'future';
                const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
                const entries = saved[stack];
                if (!Array.isArray(entries)) {
                    throw new TypeError('Expected saved split stack');
                }
                for (const [actionName, side] of [
                    ['inverseAction', 'expected'],
                    ['redoAction', 'replacement'],
                ] as const) {
                    const snapshot = savedSplitSnapshot(entries[0], actionName, side);
                    if (!Array.isArray(snapshot.clipAutomationLanes) || !isRecord(snapshot.clipAutomationLanes[0])) {
                        throw new Error('Expected genuine captured right automation');
                    }
                    expect(snapshot.clipAutomationLanes[0]).toMatchObject({ clipId: 'clip-right', trackId: TRACK_ID });
                    snapshot.clipAutomationLanes[0][owner === 'clip' ? 'clipId' : 'trackId'] =
                        owner === 'clip' ? 'clip-b' : 'other-track';
                }
                sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
                const raw = structuredClone(getCrdtDoc('root'));
                reloadSavedProject();
                const owners = ownerProjections();
                expect.soft(undoHistoryStore.value?.[stack]).toEqual([]);
                await expectReplayRefused(replay);
                expect.soft(getCrdtDoc('root')).toEqual(raw);
                expect.soft(ownerProjections()).toEqual(owners);
            }
        );

        it.each(['foreign-outer', 'foreign-nested', 'duplicate'] as const)(
            'rejects paired source satellite capture with %s ownership',
            async (corruption) => {
                setEnvelope('clip-a', {
                    clipId: 'clip-a',
                    enabled: true,
                    points: [{ id: 'gain-a', beatOffset: 0, gainDb: -6 }],
                });
                setEnvelope('clip-b', {
                    clipId: 'clip-b',
                    enabled: true,
                    points: [{ id: 'gain-b', beatOffset: 0, gainDb: -18 }],
                });
                flushAutomergeStorageWrites();
                stopProjectionBridge = setupProjectionBridge();
                projectCrdtToStores();
                await executeAppAction(
                    { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2.25, rightClipId: 'clip-right' } },
                    { source: 'manual' }
                );
                await vi.waitFor(() =>
                    expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
                );
                if (replay === 'redo') {
                    expect((await undo()).headConsumed).toBe(true);
                    await vi.waitFor(() =>
                        expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
                    );
                }
                const stack = replay === 'undo' ? 'past' : 'future';
                const side = replay === 'undo' ? 'replacement' : 'expected';
                const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
                const entries = saved[stack];
                if (!Array.isArray(entries)) {
                    throw new TypeError('Expected saved split stack');
                }
                for (const [actionName, snapshotSide] of [
                    ['inverseAction', side],
                    ['redoAction', side === 'expected' ? 'replacement' : 'expected'],
                ] as const) {
                    const snapshot = savedSplitSnapshot(entries[0], actionName, snapshotSide);
                    if (
                        !Array.isArray(snapshot.clipSatellites) ||
                        !isRecord(snapshot.clipSatellites[0]) ||
                        !isRecord(snapshot.clipSatellites[0].gainEnvelope)
                    ) {
                        throw new Error('Expected genuine captured source satellite');
                    }
                    const satellite = snapshot.clipSatellites[0];
                    const envelope = satellite.gainEnvelope;
                    if (!isRecord(envelope)) {
                        throw new TypeError('Expected captured gain envelope');
                    }
                    expect(satellite.clipId).toBe('clip-a');
                    if (corruption === 'duplicate') {
                        snapshot.clipSatellites.push(structuredClone(satellite));
                    } else {
                        envelope.clipId = 'clip-b';
                        if (corruption === 'foreign-outer') {
                            satellite.clipId = 'clip-b';
                        }
                    }
                }
                sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
                const raw = structuredClone(getCrdtDoc('root'));
                reloadSavedProject();
                const owners = ownerProjections();
                expect.soft(undoHistoryStore.value?.[stack]).toEqual([]);
                await expectReplayRefused(replay);
                expect.soft(getCrdtDoc('root')).toEqual(raw);
                expect.soft(ownerProjections()).toEqual(owners);
            }
        );
    });

    it.each([2.25, 0.5, 1 / 3])(
        'four repairs: round trips a genuine rich split at %s across binary project reload and both history legs',
        async (beat) => {
            prepareAutomationMove();
            automationStore.set({
                lanes: automationStore.value!.lanes.map((lane, index) => {
                    if (index !== 0) {
                        return lane;
                    }
                    return {
                        ...lane,
                        trimPoints: lane.trimPoints?.map((point, pointIndex) => ({
                            ...point,
                            id: `trim-original-${pointIndex}`,
                        })),
                        ghostPoints: lane.ghostPoints?.map((point, pointIndex) => ({
                            ...point,
                            id: `ghost-original-${pointIndex}`,
                        })),
                    };
                }),
            });
            trackStore.set({ ...trackStore.value!, selectedTrackId: null });
            setEnvelope('clip-a', {
                clipId: 'clip-a',
                enabled: true,
                points: [
                    { id: 'gain-start', beatOffset: 0, gainDb: -6 },
                    { id: 'gain-end', beatOffset: 3.75, gainDb: -12 },
                ],
            });
            setWarpState('clip-a', {
                enabled: true,
                markers: [
                    { id: 'warp-left', originalBeat: 0.5, warpedBeat: 0.75 },
                    { id: 'warp-right', originalBeat: 3, warpedBeat: 3.25 },
                ],
                stretchMode: 'repitch',
                originalTempo: 120,
            });
            midiStore.set({
                probabilitySeed: 1,
                notesByClipId: {
                    'clip-a': [{ id: 'straddling-note', pitch: 60, startBeat: 1.5, duration: 2, velocity: 100 }],
                },
                ccByClipId: {},
                pitchBendByClipId: {},
            });
            flushAutomergeStorageWrites();
            const originalOwners = ownerProjections();
            await executeAppAction(
                { type: 'splitClip', payload: { clipId: 'clip-a', beat, rightClipId: 'clip-right' } },
                { source: 'manual' }
            );
            const splitRaw = structuredClone(getCrdtDoc('root'));
            const splitOwnersBeforeReload = ownerProjections();
            for (const lane of originalOwners.automation!.lanes.filter((candidate) => candidate.clipId === 'clip-a')) {
                const copied = automationStore.value!.lanes.find(
                    (candidate) => candidate.clipId === 'clip-right' && candidate.parameterId === lane.parameterId
                )!;
                for (const slot of ['points', 'trimPoints', 'ghostPoints'] as const) {
                    const sourcePoints = lane[slot]?.filter((point) => point.beat >= beat) ?? [];
                    const copiedPoints = copied[slot]?.filter((point) => point.beat > beat) ?? [];
                    expect(copiedPoints.map(({ id: _id, ...point }) => point)).toEqual(
                        sourcePoints.filter((point) => point.beat > beat).map(({ id: _id, ...point }) => point)
                    );
                    for (const point of sourcePoints) {
                        if (point.id) {
                            expect(copied[slot]?.some((copy) => copy.id === point.id)).toBe(false);
                        }
                    }
                }
            }
            expect(clipOnTrack(TRACK_ID, 'clip-a')?.endBeat).toBe(beat);
            expect(clipOnTrack(TRACK_ID, 'clip-right')?.startBeat).toBe(beat);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
            );
            reloadSavedProject();
            expect(undoHistoryStore.value?.past).toHaveLength(1);
            const splitOwners = ownerProjections();
            expect(splitOwners).toEqual(splitOwnersBeforeReload);
            expect(
                captureAgentProjectInspectionState({ projectDocument: getCrdtDoc('root')!, targetIds: [] })
                    .projectInvariantsValid
            ).toBe(true);
            expect((await undo()).headConsumed).toBe(true);
            expect(ownerProjections()).toEqual(originalOwners);
            expect(clipOnTrack(TRACK_ID, 'clip-a')).toMatchObject({ startBeat: 0, endBeat: 4 });
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
            );
            reloadSavedProject();
            expect(undoHistoryStore.value?.future).toHaveLength(1);
            await redo();
            expect(getCrdtDoc('root')).toEqual(splitRaw);
            expect(ownerProjections()).toEqual(splitOwners);
            expect(undoHistoryStore.value?.future).toEqual([]);
            expect(undoHistoryStore.value?.past).toHaveLength(1);
        }
    );

    it('retains explicit empty MIDI ownership and fractional split values through binary reload and both history legs', async () => {
        prepareAutomationMove();
        const beat = 1 / 3;
        trackStore.set({ ...trackStore.value!, selectedTrackId: null });
        setEnvelope('clip-a', {
            clipId: 'clip-a',
            enabled: true,
            points: [
                { id: 'fractional-gain-left', beatOffset: 0.125, gainDb: -6.375 },
                { id: 'fractional-gain-right', beatOffset: 3.625, gainDb: -12.875 },
            ],
        });
        setWarpState('clip-a', {
            enabled: true,
            markers: [
                { id: 'fractional-warp-left', originalBeat: 0.125, warpedBeat: 0.1875 },
                { id: 'fractional-warp-right', originalBeat: 3.625, warpedBeat: 3.8125 },
            ],
            stretchMode: 'repitch',
            originalTempo: 123.456,
        });
        midiStore.set({
            probabilitySeed: 1,
            notesByClipId: {
                'clip-a': [
                    {
                        id: 'fractional-note',
                        pitch: 60,
                        startBeat: 0.125,
                        duration: 0.75,
                        velocity: 99,
                        probability: 0.625,
                    },
                ],
            },
            ccByClipId: { 'clip-a': [] },
            pitchBendByClipId: { 'clip-right': [] },
        });
        flushAutomergeStorageWrites();
        const originalOwners = ownerProjections();

        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'clip-a', beat, rightClipId: 'clip-right' } },
            { source: 'manual' }
        );
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
        );
        const splitRaw = structuredClone(getCrdtDoc('root'));
        const splitOwners = ownerProjections();
        expect([
            Object.hasOwn(splitOwners.midi!.ccByClipId, 'clip-a'),
            Object.hasOwn(splitOwners.midi!.ccByClipId, 'clip-right'),
            Object.hasOwn(splitOwners.midi!.pitchBendByClipId, 'clip-a'),
            Object.hasOwn(splitOwners.midi!.pitchBendByClipId, 'clip-right'),
        ]).toEqual([true, false, false, true]);

        reloadSavedProject();
        expect(ownerProjections()).toEqual(splitOwners);
        expect((await undo()).headConsumed).toBe(true);
        expect(ownerProjections()).toEqual(originalOwners);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
        );
        reloadSavedProject();
        expect(undoHistoryStore.value?.future).toHaveLength(1);
        await redo();
        expect(getCrdtDoc('root')).toEqual(splitRaw);
        expect(ownerProjections()).toEqual(splitOwners);
    });

    it.each(['automation', 'clip'] as const)(
        'refuses split Redo before writes when a synced peer %s reuses a captured automation point identity',
        async (owner) => {
            prepareAutomationMove();
            await executeAppAction(
                { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' } },
                { source: 'manual' }
            );
            const copiedPoint = automationStore.value?.lanes.find((lane) => lane.clipId === 'clip-right')?.points[0];
            if (copiedPoint?.id === undefined) {
                throw new Error('Expected a captured right-fragment point identity');
            }
            const copiedPointId = copiedPoint.id;
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
            );
            reloadSavedProject();
            expect((await undo()).headConsumed).toBe(true);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
            );
            reloadSavedProject();
            syncPeerProject((project) => {
                if (owner === 'clip') {
                    const track = project.tracks.tracks.find((candidate) => candidate.id === TRACK_ID);
                    if (!track) {
                        throw new Error('Expected the unrelated drawn clip track');
                    }
                    track.clips.push(createClipFixture(copiedPointId, 12.125, 16.125));
                    return;
                }
                const unrelated = project.automation.lanes.find((lane) => lane.id === 'unrelated-lane');
                if (!unrelated) {
                    throw new Error('Expected unrelated peer automation owner');
                }
                unrelated.points.push({ ...copiedPoint, id: copiedPointId, beat: 12.125, value: 0.875 });
            });
            expect(
                captureAgentProjectInspectionState({ projectDocument: getCrdtDoc('root')!, targetIds: [] })
                    .projectInvariantsValid
            ).toBe(true);
            await expectReplayRefused('redo');
        }
    );

    it('keeps a split valid when a real drawn clip already owns its preferred automation point identity', async () => {
        prepareAutomationMove();
        const occupiedId = 'asp-split-clip-right-0-point-0';
        const draw = {
            type: 'drawClip' as const,
            payload: {
                id: occupiedId,
                trackId: TRACK_ID,
                startBeat: 12,
                endBeat: 16,
                name: 'Unrelated drawn clip',
                type: 'midi' as const,
                ripple: false,
            },
        };
        const split = {
            type: 'splitClip' as const,
            payload: {
                clipId: 'clip-a',
                beat: 0.75,
                rightClipId: 'clip-right',
            },
        };
        await executeAppAction(draw, { source: 'manual' });
        expect(
            captureAgentProjectInspectionState({ projectDocument: getCrdtDoc('root')!, targetIds: [] })
                .projectInvariantsValid
        ).toBe(true);
        await executeAppAction(split, { source: 'manual' });
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(2)
        );
        projectCrdtToStores({ resetProjections: true });
        const original = clipOnTrack(TRACK_ID, occupiedId);
        expect(original).toBeDefined();
        const splitOwners = ownerProjections();
        expect(clipOnTrack(TRACK_ID, occupiedId)).toEqual(original);
        expect(
            captureAgentProjectInspectionState({ projectDocument: getCrdtDoc('root')!, targetIds: [] })
                .projectInvariantsValid
        ).toBe(true);
        reloadSavedProject();
        expect(agentProjectRepairStateStore.value).toBeNull();
        expect((await undo()).headConsumed).toBe(true);
        expect(clipOnTrack(TRACK_ID, occupiedId)).toEqual(original);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
        );
        reloadSavedProject();
        await redo();
        expect(clipOnTrack(TRACK_ID, occupiedId)).toEqual(original);
        expect(ownerProjections()).toEqual(splitOwners);
        expect(
            captureAgentProjectInspectionState({ projectDocument: getCrdtDoc('root')!, targetIds: [] })
                .projectInvariantsValid
        ).toBe(true);
        expect((await undo()).headConsumed).toBe(true);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
        );
        await redo();
        expect(ownerProjections()).toEqual(splitOwners);
    });

    it('captures the actual reserved automation identities when an admitted restoreClip precedes a split', async () => {
        prepareAutomationMove();
        const occupiedId = 'asp-split-clip-right-0-point-0';
        await executeAppAction(
            {
                type: 'drawClip',
                payload: {
                    id: occupiedId,
                    trackId: TRACK_ID,
                    startBeat: 12,
                    endBeat: 16,
                    name: 'Unrelated restored clip',
                    type: 'midi',
                    ripple: false,
                },
            },
            { source: 'manual' }
        );
        await executeAppAction(
            { type: 'removeClip', payload: { clipId: occupiedId, ripple: false } },
            { source: 'manual' }
        );
        await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(2));
        const removal = undoHistoryStore.value?.past.at(-1);
        const restore = removal?.kind === 'action' ? removal.inverseAction : null;
        if (restore?.type !== 'restoreClip') {
            throw new Error(`Expected the real removal inverse: ${JSON.stringify(removal)}`);
        }
        const result = await executeAppActionBatch(
            [
                structuredClone(restore),
                { type: 'splitClip', payload: { clipId: 'clip-a', beat: 0.75, rightClipId: 'clip-right' } },
            ],
            { source: 'manual', groupId: 'restore-split-identities' }
        );
        expect(result).toMatchObject({ status: 'committed' });
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(3)
        );
        const splitEntry = undoHistoryStore.value?.past.at(-1);
        const redoAction = splitEntry?.kind === 'action' ? splitEntry.redoAction : null;
        if (redoAction?.type !== 'restoreClipSplitState') {
            throw new Error('Expected the split replay capture');
        }
        expect(automationStore.value?.lanes.filter((lane) => lane.clipId === 'clip-right')).toEqual(
            redoAction.payload.replacement.clipAutomationLanes
        );
        expect(
            captureAgentProjectInspectionState({ projectDocument: getCrdtDoc('root')!, targetIds: [] })
                .projectInvariantsValid
        ).toBe(true);
        projectCrdtToStores({ resetProjections: true });
        const splitOwners = ownerProjections();
        reloadSavedProject();
        expect((await undo()).headConsumed).toBe(true);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
        );
        reloadSavedProject();
        await redo();
        expect(clipOnTrack(TRACK_ID, occupiedId)).toBeDefined();
        expect(ownerProjections()).toEqual(splitOwners);
        expect((await undo()).headConsumed).toBe(true);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
        );
        reloadSavedProject();
        await redo();
        expect(ownerProjections()).toEqual(splitOwners);
    });

    it('keeps preferred copied automation IDs when matching gain point IDs are clip-local', async () => {
        prepareAutomationMove();
        const id = 'asp-split-clip-right-0-point-0';
        setEnvelope('clip-b', { clipId: 'clip-b', enabled: true, points: [{ id, beatOffset: 0, gainDb: -42 }] });
        flushAutomergeStorageWrites();
        projectCrdtToStores({ resetProjections: true });
        const originalOwners = ownerProjections();
        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'clip-a', beat: 0.75, rightClipId: 'clip-right' } },
            { source: 'manual' }
        );
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
        );
        expect(
            automationStore.value?.lanes
                .filter((lane) => lane.clipId === 'clip-right')
                .flatMap((lane) => lane.points.map((point) => point.id))
        ).toContain(id);
        const splitOwners = ownerProjections();
        expect(
            captureAgentProjectInspectionState({ projectDocument: getCrdtDoc('root')!, targetIds: [] })
                .projectInvariantsValid
        ).toBe(true);
        reloadSavedProject();
        expect(agentProjectRepairStateStore.value).toBeNull();
        expect((await undo()).headConsumed).toBe(true);
        expect(ownerProjections()).toEqual(originalOwners);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
        );
        reloadSavedProject();
        await redo();
        expect(ownerProjections()).toEqual(splitOwners);
    });

    it.each(['point', 'trim', 'ghost', 'seam', 'lane', 'objectPoint'] as const)(
        'keeps a split replayable when a reminted automation %s id collides with an unrelated owner',
        async (kind) => {
            let collisionPointId = `asp-split-clip-right-0-${kind}-0`;
            if (kind === 'lane') {
                collisionPointId = 'auto-split-clip-right-0';
            } else if (kind === 'seam') {
                collisionPointId = 'asp-split-clip-right-0';
            } else if (kind === 'objectPoint') {
                collisionPointId = 'asp-split-clip-right-0-point-0';
            }
            prepareAutomationMove();
            automationStore.set({
                lanes: automationStore.value!.lanes.map((lane) => {
                    if (lane.id === 'clip-lane-a') {
                        return {
                            ...lane,
                            trimPoints: lane.trimPoints?.map((point) => ({ ...point, id: 'source-trim' })),
                            ghostPoints: lane.ghostPoints?.map((point) => ({ ...point, id: 'source-ghost' })),
                        };
                    }
                    if (lane.id !== 'unrelated-lane') {
                        return lane;
                    }
                    const point = { ...lane.points[0]!, id: collisionPointId, beat: 0.125, value: 0.875 };
                    const copy = { ...lane, points: [point] };
                    if (kind === 'lane') {
                        copy.id = collisionPointId;
                        point.id = 'unrelated-point';
                    }
                    if (kind === 'objectPoint') {
                        point.id = 'unrelated-point';
                        copy.objects = [
                            {
                                id: 'unrelated-object',
                                laneId: lane.id,
                                name: 'Unrelated object',
                                startBeat: 0,
                                endBeat: 1,
                                points: [{ ...lane.points[0]!, id: collisionPointId, beat: 0.125, value: 0.625 }],
                            },
                        ];
                    }
                    return copy;
                }),
            });
            flushAutomergeStorageWrites();
            projectCrdtToStores({ resetProjections: true });
            const originalOwners = ownerProjections();
            expect(
                captureAgentProjectInspectionState({ projectDocument: getCrdtDoc('root')!, targetIds: [] })
                    .projectInvariantsValid
            ).toBe(true);

            await executeAppAction(
                { type: 'splitClip', payload: { clipId: 'clip-a', beat: 0.75, rightClipId: 'clip-right' } },
                { source: 'manual' }
            );
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(1)
            );
            const splitOwners = ownerProjections();
            const collisionOwners = splitOwners.automation!.lanes.flatMap((lane) => {
                const owners: string[] = [];
                if (lane.id === collisionPointId) {
                    owners.push(lane.id);
                }
                const points = [...lane.points];
                if (lane.trimPoints) {
                    points.push(...lane.trimPoints);
                }
                if (lane.ghostPoints) {
                    points.push(...lane.ghostPoints);
                }
                for (const point of points) {
                    if (point.id === collisionPointId) {
                        owners.push(lane.id);
                    }
                }
                for (const object of lane.objects) {
                    for (const point of object.points) {
                        if (point.id === collisionPointId) {
                            owners.push(object.id);
                        }
                    }
                }
                return owners;
            });
            expect.soft(collisionOwners).toHaveLength(1);
            expect
                .soft(
                    captureAgentProjectInspectionState({ projectDocument: getCrdtDoc('root')!, targetIds: [] })
                        .projectInvariantsValid
                )
                .toBe(true);

            reloadSavedProject();
            expect.soft(agentProjectRepairStateStore.value).toBeNull();
            expect.soft(ownerProjections()).toEqual(splitOwners);
            expect.soft(undoHistoryStore.value?.past).toHaveLength(1);
            expect.soft((await undo()).headConsumed).toBe(true);
            expect.soft(ownerProjections()).toEqual(originalOwners);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
            );
            reloadSavedProject();
            await redo();
            expect(ownerProjections()).toEqual(splitOwners);
            expect((await undo()).headConsumed).toBe(true);
            expect(ownerProjections()).toEqual(originalOwners);
        }
    );

    it('rejects a saved split with a foreign retired right-fragment lane owner before Redo writes', async () => {
        trackStore.set({
            ...trackStore.value!,
            tracks: [
                TrackDummy.create({
                    id: TRACK_ID,
                    kind: 'audio',
                    clips: [{ ...createClipFixture('clip-a', 0, 4), type: 'audio', audioBufferId: 'recorded-buffer' }],
                }),
                createTrack({ id: 'other-track', name: 'Other track', kind: 'audio' }),
            ],
        });
        flushAutomergeStorageWrites();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        await executeAppAction(
            { type: 'splitClip', payload: { clipId: 'clip-a', beat: 2, rightClipId: 'clip-right' } },
            { source: 'manual' }
        );
        const placed = placeTakeOnClipMedia(
            { ...createTake('clip-right', 'Later pass', 2, 4, 1), selected: true },
            {
                recordPointBeat: 3,
                mediaOriginSeconds: 1.5,
                clipMediaOriginSeconds: 1,
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
            activeCompRegions: [{ startBeat: 2, endBeat: 4, takeId: placed.id }],
        };
        syncPeerProject((project) => {
            project.takeLanes.lanes.push(lane);
        });
        expect((await undo()).headConsumed).toBe(true);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        await vi.waitFor(() =>
            expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(1)
        );
        const saved = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
        if (!Array.isArray(saved.future) || !isRecord(saved.future[0])) {
            throw new Error('Expected saved split future');
        }
        for (const actionName of ['inverseAction', 'redoAction'] as const) {
            const action = saved.future[0][actionName];
            if (!isRecord(action) || !isRecord(action.payload) || !Array.isArray(action.payload.retiredTakeLanes)) {
                throw new Error('Expected saved split retired takes');
            }
            expect(action.payload.retiredTakeLanes).toMatchObject([{ lane, retiredTakeIds: [placed.id] }]);
            const retired = action.payload.retiredTakeLanes[0];
            if (!isRecord(retired) || !isRecord(retired.lane)) {
                throw new Error('Expected saved split lane');
            }
            retired.lane.trackId = 'other-track';
        }
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(saved));
        const raw = structuredClone(getCrdtDoc('root'));
        const owners = ownerProjections();
        hydrateProductionContracts();
        expect(undoHistoryStore.value?.future).toEqual([]);
        const history = structuredClone(undoHistoryStore.value);
        await redo();
        expect(getCrdtDoc('root')).toEqual(raw);
        expect(ownerProjections()).toEqual(owners);
        expect(undoHistoryStore.value).toEqual(history);
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
        syncPeerProject((project) => {
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
        reloadSavedProject();
        const later = {
            id: 'peer-left-take',
            clipId: 'clip-a',
            name: 'Later peer choice',
            startBeat: 0,
            endBeat: 2,
            selected: true,
        };
        syncPeerProject((project) => {
            project.takeLanes.lanes.push({
                id: 'new-correct-lane',
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
                id: 'new-correct-lane',
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

    it.each([false, true])(
        'four repairs: keeps a paired remove capture unchanged when Redo aborts at commit grouped=%s',
        async (grouped) => {
            workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
            flushAutomergeStorageWrites();
            stopProjectionBridge = setupProjectionBridge();
            projectCrdtToStores();
            if (grouped) {
                const result = await executeAppActionBatch(
                    [
                        { type: 'removeClip', payload: { clipId: 'clip-a' } },
                        { type: 'removeClip', payload: { clipId: 'clip-b' } },
                    ],
                    { source: 'manual', groupId: 'remove-abort-probe' }
                );
                expect(result.status, JSON.stringify(result)).toBe('committed');
            } else {
                await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
            }
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(
                    grouped ? 2 : 1
                )
            );
            reloadSavedProject();
            expect((await undo()).headConsumed).toBe(true);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(
                    grouped ? 2 : 1
                )
            );
            reloadSavedProject();
            const laterTake = { ...createTake('clip-a', 'Later restored take', 0, 4), selected: true };
            syncPeerProject((project) => {
                project.takeLanes.lanes.push({
                    ...createTakeLane(TRACK_ID),
                    id: 'later-restored-lane',
                    takes: [laterTake],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: laterTake.id }],
                });
            });
            await flushPersistence();
            const raw = structuredClone(getCrdtDoc('root'));
            const heads = Automerge.getHeads(getCrdtDoc('root')!);
            const owners = ownerProjections();
            const history = structuredClone(undoHistoryStore.value);
            const heldInverse =
                undoHistoryStore.value?.future[0]?.kind === 'action'
                    ? undoHistoryStore.value.future[0].inverseAction
                    : null;
            const heldCapture = structuredClone(heldInverse);
            const mirror = sessionStorage.getItem(UNDO_SESSION_KEY);
            const historyWrite = vi.spyOn(undoHistoryStore, 'set');
            if (grouped) {
                refuseBatchAtCommit();
            } else {
                productionBriefAdmissionPort.setGuard(() => {
                    let checks = 0;
                    return { allowsCurrent: () => ++checks === 1 };
                });
            }

            try {
                await redo();
                expect.soft(getCrdtDoc('root')).toEqual(raw);
                expect.soft(Automerge.getHeads(getCrdtDoc('root')!)).toEqual(heads);
                expect.soft(ownerProjections()).toEqual(owners);
                expect.soft(historyWrite).not.toHaveBeenCalled();
                expect.soft(sessionStorage.getItem(UNDO_SESSION_KEY)).toBe(mirror);
                expect.soft(undoHistoryStore.value).toEqual(history);
                expect.soft(heldInverse).toEqual(heldCapture);
            } finally {
                historyWrite.mockRestore();
            }
        }
    );

    it.each([
        { grouped: false, warning: false, ambiguous: false, foreign: false },
        { grouped: true, warning: false, ambiguous: false, foreign: false },
        { grouped: false, warning: true, ambiguous: false, foreign: false },
        { grouped: true, warning: true, ambiguous: false, foreign: false },
        { grouped: false, warning: false, ambiguous: true, foreign: false },
        { grouped: true, warning: false, ambiguous: true, foreign: false },
        { grouped: false, warning: false, ambiguous: true, foreign: true },
        { grouped: true, warning: false, ambiguous: true, foreign: true },
        { grouped: false, warning: true, ambiguous: false, foreign: true },
        { grouped: true, warning: true, ambiguous: false, foreign: true },
    ])(
        'four repairs: installs fresh remove capture only after committed Redo $grouped warning=$warning ambiguous=$ambiguous foreign=$foreign',
        async ({ grouped, warning, ambiguous, foreign }) => {
            workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
            flushAutomergeStorageWrites();
            stopProjectionBridge = setupProjectionBridge();
            projectCrdtToStores();
            if (grouped) {
                const result = await executeAppActionBatch(
                    [
                        { type: 'removeClip', payload: { clipId: 'clip-a' } },
                        { type: 'removeClip', payload: { clipId: 'clip-b' } },
                    ],
                    { source: 'manual', groupId: 'remove-abort-probe' }
                );
                expect(result.status, JSON.stringify(result)).toBe('committed');
            } else {
                await executeAppAction({ type: 'removeClip', payload: { clipId: 'clip-a' } }, { source: 'manual' });
            }
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(
                    grouped ? 2 : 1
                )
            );
            reloadSavedProject();
            expect((await undo()).headConsumed).toBe(true);
            await vi.waitFor(() =>
                expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).future).toHaveLength(
                    grouped ? 2 : 1
                )
            );
            reloadSavedProject();
            const laterTake = { ...createTake('clip-a', 'Later restored take', 0, 4), selected: true };
            syncPeerProject((project) => {
                project.takeLanes.lanes.push({
                    ...createTakeLane(TRACK_ID),
                    id: 'later-restored-lane',
                    takes: [laterTake],
                    activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: laterTake.id }],
                });
            });
            await flushPersistence();
            const rootBeforeRedo = Automerge.clone(getCrdtDoc('root')!);
            const peerOwners = ownerProjections();
            const heldEntry = undoHistoryStore.value?.future.find(
                (entry) =>
                    entry.kind === 'action' &&
                    entry.action.type === 'removeClip' &&
                    entry.action.payload.clipId === 'clip-a'
            );
            if (heldEntry?.kind !== 'action') {
                throw new Error('Expected retained removal entry');
            }
            const previousInverse = structuredClone(heldEntry.inverseAction);
            const heldEntries = undoHistoryStore.value!.future.filter((entry) => entry.kind === 'action');
            const inverseReferences = heldEntries.map((entry) => entry.inverseAction);
            const inverseValues = heldEntries.map((entry) => structuredClone(entry.inverseAction));
            const originalExecute = handleRemoveClip.execute;
            let replaced = false;
            const removalEffect = vi.spyOn(handleRemoveClip, 'execute');
            if (foreign) {
                removalEffect.mockImplementation(async (action, context) => {
                    const result = await originalExecute(action, context);
                    if (!result?.afterAmbiguousCommit) {
                        throw new Error('Expected real deferred removal effect');
                    }
                    const afterAmbiguousCommit = result.afterAmbiguousCommit;
                    return {
                        ...result,
                        afterAmbiguousCommit: async () => {
                            if (!replaced) {
                                replaced = true;
                                const replacement = Automerge.clone(getCrdtDoc('root')!);
                                replaceCrdtDocInLineage({ id: 'root', doc: replacement });
                                expect(getCrdtDoc('root')).toBe(replacement);
                            }
                            await afterAmbiguousCommit();
                        },
                    };
                });
            }
            macroStore.set({ macros: [], recording: warning, currentRecording: [] });
            const macroWrite = vi.spyOn(macroStore, 'set');
            if (warning) {
                macroWrite.mockImplementationOnce(() => {
                    if (foreign && !replaced) {
                        replaced = true;
                        replaceCrdtDocInLineage({ id: 'root', doc: rootBeforeRedo });
                        expect(getCrdtDoc('root')).toBe(rootBeforeRedo);
                    }
                    throw new Error('Controlled committed macro warning');
                });
            }
            if (ambiguous) {
                let throwAfterPublication = true;
                configureAutomergeStoragePort({
                    getDoc: (docId) => getCrdtDoc<Record<string, unknown>>(docId),
                    getDocHeads: (docId) => Automerge.getHeads(getCrdtDoc(docId)!),
                    getSemanticMessage: () => undefined,
                    hasDoc: (docId) => getCrdtDoc(docId) !== undefined,
                    mutateDoc: ({ docId, changeFn, message, changedKeys, snapshotTransaction }) => {
                        mutateCrdtDoc({ id: docId, changeFn, message, localSlots: changedKeys, snapshotTransaction });
                        if (throwAfterPublication) {
                            throwAfterPublication = false;
                            throw new Error('Controlled failure after own raw root publication');
                        }
                    },
                });
            }
            try {
                if (warning || ambiguous) {
                    await expect(redo()).rejects.toSatisfy(isAppActionCommittedError);
                } else {
                    await redo();
                }
                expect(undoHistoryStore.value?.future).toEqual([]);
                expect(undoHistoryStore.value?.past).toHaveLength(grouped ? 2 : 1);
                for (const [index, entry] of heldEntries.entries()) {
                    if (foreign) {
                        expect(entry.inverseAction).toBe(inverseReferences[index]);
                        expect(entry.inverseAction).toEqual(inverseValues[index]);
                    } else if (!foreign) {
                        expect(entry.inverseAction).not.toBe(inverseReferences[index]);
                    }
                }
                if (!foreign) {
                    expect(heldEntry.inverseAction).not.toEqual(previousInverse);
                }
                await vi.waitFor(() =>
                    expect(parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY)).past).toHaveLength(
                        grouped ? 2 : 1
                    )
                );
                registerCrdtStorageRuntime();
                if (foreign) {
                    expect(replaced).toBe(true);
                    if (warning) {
                        expect(getCrdtDoc('root')).toBe(rootBeforeRedo);
                    }
                    const persisted = parsePersistedUndoState(sessionStorage.getItem(UNDO_SESSION_KEY));
                    expect(persisted.future).toEqual([]);
                    expect(
                        undoHistoryStore.value?.past.map((entry) =>
                            entry.kind === 'action' ? entry.inverseAction : null
                        )
                    ).toEqual(inverseValues);
                    return;
                }
                reloadSavedProject();
                expect((await undo()).headConsumed).toBe(true);
                expect(takeLaneStore.value).toEqual(peerOwners.takes);
                expect(midiStore.value).toEqual(peerOwners.midi);
                expect(automationStore.value).toEqual(peerOwners.automation);
                expect(gainEnvelopeStore.value).toEqual(peerOwners.gain);
                expect(warpStateStore.value).toEqual(peerOwners.warp);
                const raw = getCrdtDoc<PeerProject>('root');
                expect(raw?.takeLanes).toEqual(peerOwners.takes);
            } finally {
                macroWrite.mockRestore();
                removalEffect.mockRestore();
            }
        }
    );

    it.each([
        {
            name: 'audio offset',
            corrupt: (clip: Record<string, unknown>) => {
                clip.audioOffsetBeats = 'older-file-offset';
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
