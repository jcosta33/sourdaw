import * as Automerge from '@automerge/automerge';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerKernelPorts } from '#/app/registerKernelPorts';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { defaultTrackState, trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    executeUserAppAction,
    isAppActionAdmissionRefusal,
    isAppActionConflictError,
    isExecutableAppActionType,
    productionBriefAdmissionPort,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureDurableDocumentWitness,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    hasCrdtDoc,
    loadCrdtProject,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    persistCrdtProject,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
    sessionUndoWitnessStampPort,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { productionBriefActionBatchAdmission } from '#/modules/Project/useCases';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';
import { createSeededRandom } from '#/utils/SeededRandom/SeededRandom';
import { isRecord } from '#/utils/structuralEquality';

import { type AutomationLane, type AutomationPoint } from '../../../models/Automation';
import { automationStore, type AutomationStoreState } from '../../../stores/automationStore';
import { insertAutomationLanePoints } from '../../../useCases/automation/insertAutomationLanePoints';

type Root = { automation: AutomationStoreState; tracks: TrackStoreState };
type InsertAction = Extract<AppAction, { type: 'insertAutomationLanePoints' }>;
type BriefScope = (typeof defaultProjectStoreState.productionBrief.locks)[number]['scope'];

const SESSION_KEY = 'sourdaw-undo-session';
const PROJECT_ID = 'automation-insertion-project';
const TRACK_ID = 'automation-track';
const ORIGINAL_COLOR = '#314159';
const EDITED_COLOR = '#ff6347';
const TARGET = 'gain-lane';
const OTHER = 'pan-lane';

const initialPoints: AutomationPoint[] = [
    { id: 'unaffected-start', beat: 2, value: 0.2, curve: 'linear', tension: 0 },
    {
        id: 'straddling-start',
        beat: 3.98,
        value: 0.8,
        curve: 'bezier',
        tension: -0.5,
        cp1: { x: 0.25, y: 0.9 },
        cp2: { x: 0.75, y: 0.1 },
    },
    { beat: 6, value: 0.7, curve: 'step', tension: 0.25 },
    { id: 'step-after', beat: 6, value: 0.3, curve: 'step', tension: -0.25 },
    { id: 'straddling-end', beat: 8.01, value: 0.6, curve: 'stairs', tension: 0.4, stairSteps: 4 },
    { id: 'unaffected-end', beat: 12, value: 0.9, curve: 'linear', tension: 0 },
];

function lane(id: string, parameterId: string, points: AutomationPoint[]): AutomationLane {
    return {
        id,
        trackId: TRACK_ID,
        parameterId,
        parameterName: parameterId,
        points,
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 2,
        color: '#a1b2c3',
    };
}

const targetLane = lane(TARGET, 'gain', initialPoints);
const otherLane = lane(OTHER, 'pan', [{ id: 'other-keeper', beat: 6, value: 0.7, curve: 'step', tension: 0 }]);

function root(): Automerge.Doc<Root> {
    const document = getCrdtDoc<Root>('root');
    if (!document) {
        throw new Error('Expected the active project document');
    }
    return document;
}

function readLane() {
    const raw = Automerge.toJS(root()).automation;
    expect(automationStore.value).toStrictEqual(raw);
    expect(raw.lanes[1]).toStrictEqual(otherLane);
    const target = raw.lanes[0]!;
    expect({ ...target, points: [] }).toStrictEqual({ ...targetLane, points: [] });
    return target.points;
}

function readColor() {
    const raw = root().tracks.tracks.find((track) => track.id === TRACK_ID)?.color;
    expect(trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.color).toBe(raw);
    return raw;
}

function shapeAction(): InsertAction {
    return {
        type: 'insertAutomationLanePoints',
        payload: {
            laneId: TARGET,
            owner: { trackId: TRACK_ID, parameterId: 'gain' },
            insertion: { kind: 'shape', shape: 'random', startBeat: 4, endBeat: 8 },
        },
    };
}

function pointAction(beat = 4.5): InsertAction {
    return {
        type: 'insertAutomationLanePoints',
        payload: {
            laneId: TARGET,
            owner: { trackId: TRACK_ID, parameterId: 'gain' },
            insertion: { kind: 'point', point: { beat, value: 0.45, curve: 'linear', tension: 0 } },
        },
    };
}

function readHistory() {
    return undoHistoryStore.value;
}

function registerCommands() {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

function setLock(scope: BriefScope) {
    const project = projectStore.value!;
    projectStore.set({
        ...project,
        productionBrief: {
            ...project.productionBrief,
            locks: [{ id: 'locked-zone', scope, statement: 'Keep this edit', createdAt: 1 }],
        },
    });
    flushAutomergeStorageWrites();
}

function refusalState() {
    return {
        heads: Automerge.getHeads(root()),
        raw: Automerge.toJS(root()),
        projected: structuredClone(automationStore.value),
        history: structuredClone(readHistory()),
        pending: countPendingAutomergeStorageWrites(),
    };
}

function editRawLane(edit: (lane: AutomationLane) => void) {
    mutateCrdtDoc<Root>({
        id: 'root',
        changeFn: (document) => edit(document.automation.lanes[0]!),
    });
}

async function reloadFromIndexedDb() {
    const { past, future } = readHistory()!;
    await vi.waitFor(() => {
        const session: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
        expect(session).toMatchObject({
            past: Array.from({ length: past.length }, () => expect.any(Object)),
            future: Array.from({ length: future.length }, () => expect.any(Object)),
        });
    });
    await persistCrdtProject();
    const witness = captureDurableDocumentWitness();
    expect(witness).toEqual(expect.any(String));
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')).toMatchObject({ projectId: PROJECT_ID, witness });
    removeCrdtDoc('root');
    expect(hasCrdtDoc('root')).toBe(false);
    createCrdtDoc('root');
    await expect(loadCrdtProject()).resolves.toBe(true);
    projectCrdtToStores({ resetProjections: true });
    expect(captureDurableDocumentWitness()).toBe(witness);
    registerCommands();
    expect(readHistory()).toMatchObject({ past, future });
    for (const [stored, restored] of [
        [past, readHistory()?.past],
        [future, readHistory()?.future],
    ] as const) {
        for (const [index, entry] of stored.entries()) {
            expect(restored?.[index]).not.toBe(entry);
        }
    }
}

function syncPeer(peer: Automerge.Doc<Root>) {
    let source = Automerge.clone(root());
    let sourceState = Automerge.initSyncState();
    let peerState = Automerge.initSyncState();
    let received = false;
    for (let round = 0; round < 8; round += 1) {
        const [nextSourceState, outgoing] = Automerge.generateSyncMessage(source, sourceState);
        sourceState = nextSourceState;
        if (outgoing) {
            [peer, peerState] = Automerge.receiveSyncMessage(peer, peerState, outgoing);
            received = true;
        }
        const [nextPeerState, incoming] = Automerge.generateSyncMessage(peer, peerState);
        peerState = nextPeerState;
        if (incoming) {
            [source, sourceState] = Automerge.receiveSyncMessage(source, sourceState, incoming);
        }
        if (!outgoing && !incoming) {
            return { peer, received, sourceHeads: Automerge.getHeads(source) };
        }
    }
    throw new Error('Peer sync did not settle');
}

describe('local automation lane insertion', () => {
    let indexedDb: ReturnType<typeof installTransactionalIndexedDb>;
    const notices: NotifyPayload[] = [];

    beforeAll(() => {
        indexedDb = installTransactionalIndexedDb();
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        bus.on('ui.notify', (notice) => {
            notices.push(notice);
        });
        setNotificationEventBus(bus);
    });

    afterAll(async () => {
        await indexedDb.dispose();
    });

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('automation insertion');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        registerKernelPorts();
        productionBriefAdmissionPort.setGuard(productionBriefActionBatchAdmission.capture);
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        sessionUndoWitnessStampPort.setProvider(stampSessionUndoWitness);
        notices.length = 0;

        clearUndoHistory();
        resetActionReplayAuthority();
        sessionStorage.removeItem(SESSION_KEY);
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false });
        trackStore.set({
            ...structuredClone(defaultTrackState),
            tracks: [
                {
                    ...createTrack({ id: TRACK_ID, name: 'Track', kind: 'midi', withoutDefaultDevice: true }),
                    color: ORIGINAL_COLOR,
                },
            ],
        });
        automationStore.set({ lanes: structuredClone([targetLane, otherLane]) });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        flushAutomergeStorageWrites();
        registerCommands();
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        resetActionReplayAuthority();
        sessionStorage.removeItem(SESSION_KEY);
        agentProjectRepairStateStore.set(null);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        sessionUndoWitnessStampPort.setProvider(null);
    });

    it('keeps one exact shape entry, the previous point, and color across past and future reloads', async () => {
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: TRACK_ID, color: EDITED_COLOR } });
        await executeAppAction(pointAction());
        const afterPoint = readLane();
        const manual = afterPoint.find((point) => point.beat === 4.5);
        expect(manual).toStrictEqual({
            id: expect.any(String),
            beat: 4.5,
            value: 0.45,
            curve: 'linear',
            tension: 0,
        });
        expect(readColor()).toBe(EDITED_COLOR);
        const prefix = readHistory()?.past.slice();
        expect(prefix?.map((entry) => entry.label)).toEqual(['Set track color', 'Add automation point']);

        await executeAppAction(shapeAction());

        const inserted = readLane();
        const generated = inserted.filter((point) => point.id?.startsWith('auto-point-'));
        const random = createSeededRandom(4000);
        expect(generated).toEqual(
            Array.from({ length: 9 }, (_, index) => ({
                id: expect.any(String),
                beat: 4 + index * 0.5,
                value: 2 * random(),
                curve: 'linear',
                tension: 0,
            }))
        );
        expect(new Set(generated.map((point) => point.id)).size).toBe(9);
        expect(generated.map((point) => point.id)).not.toContain(manual?.id);
        expect(inserted).toStrictEqual([
            initialPoints[0],
            ...generated.slice(0, 5),
            initialPoints[3],
            ...generated.slice(5),
            initialPoints[5],
        ]);
        const entry = readHistory()?.past.at(-1);
        expect(readHistory()).toMatchObject({ past: [...prefix!, entry], future: [] });
        expect(entry).toMatchObject({
            kind: 'action',
            label: 'Insert automation shape',
            action: { payload: { capture: { before: afterPoint, after: inserted } } },
            inverseAction: { payload: { direction: 'undo', capture: { before: afterPoint, after: inserted } } },
        });

        await reloadFromIndexedDb();
        expect(readLane()).toStrictEqual(inserted);
        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: true });
        expect(readLane()).toStrictEqual(afterPoint);
        expect(readHistory()).toMatchObject({ past: prefix, future: [entry] });
        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: true });
        expect(readLane()).toStrictEqual(initialPoints);
        expect(readColor()).toBe(EDITED_COLOR);
        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: true });
        expect(readColor()).toBe(ORIGINAL_COLOR);

        await reloadFromIndexedDb();
        await redo({ stepOverConflicts: false });
        expect(readColor()).toBe(EDITED_COLOR);
        await redo({ stepOverConflicts: false });
        expect(readLane()).toStrictEqual(afterPoint);
        await redo({ stepOverConflicts: false });
        expect(readLane()).toStrictEqual(inserted);
        expect(readHistory()).toMatchObject({ past: [...prefix!, entry], future: [] });
    });

    it('syncs the exact arrays to a peer after a same-beat point, shape, Undo and Redo', async () => {
        let peer = Automerge.clone(root());
        await executeAppAction(pointAction(6));
        const afterPoint = readLane();
        const tied = afterPoint.filter((point) => point.beat === 6);
        expect(tied).toHaveLength(3);
        expect(tied.slice(0, 2)).toStrictEqual(initialPoints.slice(2, 4));
        expect(tied[2]).toMatchObject({ id: expect.any(String), value: 0.45 });
        function verifyPeer(expected: AutomationPoint[]) {
            const synced = syncPeer(peer);
            peer = synced.peer;
            expect(synced.received).toBe(true);
            expect(Automerge.getHeads(peer)).toEqual(synced.sourceHeads);
            expect(Automerge.toJS(peer).automation.lanes).toStrictEqual([
                { ...targetLane, points: expected },
                otherLane,
            ]);
            replaceCrdtDocInLineage({ id: 'root', doc: Automerge.clone(peer) });
            projectCrdtToStores({ resetProjections: true });
            expect(readLane()).toStrictEqual(expected);
        }

        verifyPeer(afterPoint);
        await executeAppAction(shapeAction());
        const inserted = readLane();
        verifyPeer(inserted);
        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: true });
        verifyPeer(afterPoint);
        await redo({ stepOverConflicts: false });
        verifyPeer(inserted);
    });

    it.each(['point', 'shape'] as const)('settles adjacent manual point and %s edits in order', async (next) => {
        let prospectiveWrites = 0;
        let follower: Promise<void> | undefined;
        const unsubscribe = automationStore.subscribe((state) => {
            if (follower || !state?.lanes[0]?.points.some((point) => point.beat === 4.5)) {
                return;
            }
            prospectiveWrites = countPendingAutomergeStorageWrites();
            const action = next === 'point' ? pointAction(5) : shapeAction();
            follower = insertAutomationLanePoints(targetLane, action.payload.insertion);
        });
        try {
            await insertAutomationLanePoints(targetLane, pointAction().payload.insertion);
        } finally {
            unsubscribe();
        }
        expect(follower).toBeDefined();
        await follower;

        expect(prospectiveWrites).toBeGreaterThan(0);
        const entries = readHistory()?.past;
        expect(entries).toHaveLength(2);
        const beforeSecond = readLane();
        const laterLabel = next === 'shape' ? 'Insert automation shape' : 'Add automation point';
        expect(entries?.map((entry) => entry.label)).toEqual(['Add automation point', laterLabel]);
        expect(beforeSecond.some((point) => point.beat === 4.5)).toBe(true);
        expect(beforeSecond.some((point) => point.beat === 5)).toBe(true);
        expect(notices).toEqual([]);
        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: true });
        expect(readLane()).toStrictEqual([
            ...initialPoints.slice(0, 2),
            { id: expect.any(String), beat: 4.5, value: 0.45, curve: 'linear', tension: 0 },
            ...initialPoints.slice(2),
        ]);
    });

    it('settles two insertions submitted in the same turn', async () => {
        const first = insertAutomationLanePoints(targetLane, pointAction().payload.insertion);
        const second = insertAutomationLanePoints(targetLane, pointAction(5).payload.insertion);
        await Promise.all([first, second]);

        expect(readHistory()?.past.map((entry) => entry.label)).toEqual([
            'Add automation point',
            'Add automation point',
        ]);
        expect(readLane().map((point) => point.beat)).toEqual([2, 3.98, 4.5, 5, 6, 6, 8.01, 12]);
        expect(notices).toEqual([]);
    });

    it('does not carry a queued gesture over a root installation', async () => {
        const unsubscribe = undoHistoryStore.subscribe((history) => {
            if (history?.past.length !== 1) {
                return;
            }
            unsubscribe();
            replaceCrdtDoc({ id: 'root', doc: Automerge.clone(root()) });
            projectCrdtToStores({ resetProjections: true });
        });
        const first = insertAutomationLanePoints(targetLane, pointAction().payload.insertion);
        const second = insertAutomationLanePoints(targetLane, shapeAction().payload.insertion);
        try {
            await Promise.all([first, second]);
        } finally {
            unsubscribe();
        }

        expect(readHistory()?.past.map((entry) => entry.label)).toEqual(['Add automation point']);
        expect(readLane().map((point) => point.beat)).toEqual([2, 3.98, 4.5, 6, 6, 8.01, 12]);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(notices).toHaveLength(1);
    });

    it('allows the next insertion when the previous request is refused', async () => {
        const first = insertAutomationLanePoints(
            { ...targetLane, parameterId: 'wrong' },
            pointAction().payload.insertion
        );
        const second = insertAutomationLanePoints(targetLane, pointAction(5).payload.insertion);
        await Promise.all([first, second]);

        expect(readHistory()?.past.map((entry) => entry.label)).toEqual(['Add automation point']);
        expect(readLane().map((point) => point.beat)).toEqual([2, 3.98, 5, 6, 6, 8.01, 12]);
        expect(notices).toHaveLength(1);
    });

    it('notifies the user when the raw lane changes after a write was staged', async () => {
        const history = structuredClone(readHistory());
        let peerHeads: string[] | undefined;

        await executeUserAppAction(shapeAction(), {
            observeMaterializedAction: () => {
                queueMicrotask(() => {
                    expect(countPendingAutomergeStorageWrites()).toBeGreaterThan(0);
                    editRawLane((lane) => {
                        lane.points[0]!.value = 0.99;
                    });
                    peerHeads = Automerge.getHeads(root());
                });
            },
        });

        expect(peerHeads).toBeDefined();
        expect(Automerge.getHeads(root())).toEqual(peerHeads);
        expect(Automerge.toJS(root()).automation.lanes[0]?.points).toStrictEqual([
            { ...initialPoints[0], value: 0.99 },
            ...initialPoints.slice(1),
        ]);
        expect(readHistory()).toEqual(history);
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(notices).toEqual([
            { level: 'warning', message: expect.stringContaining('was refused because the project') },
        ]);
    });

    it.each([
        { startBeat: 4.125, endBeat: 4.25 },
        { startBeat: 8, endBeat: 8.005 },
        { startBeat: 3.97, endBeat: 4 },
        { startBeat: 8.005, endBeat: 8.02 },
    ])(
        'refuses the shape interior, endpoint or epsilon neighbour in [$startBeat, $endBeat)',
        async ({ startBeat, endBeat }) => {
            await executeAppAction(pointAction());
            setLock({ kind: 'range', startBeat, endBeat });
            const before = refusalState();

            await expect(executeAppAction(shapeAction())).rejects.toSatisfy(isAppActionAdmissionRefusal);

            expect(refusalState()).toEqual(before);
        }
    );

    it.each([
        { scope: { kind: 'range', startBeat: 1.9, endBeat: 2.1 } },
        { scope: { kind: 'object', objectType: 'automationPoint', objectId: 'unaffected-start' } },
    ] satisfies { scope: BriefScope }[])(
        'admits the shape and replay with an untouched point protected by a $scope.kind lock',
        async ({ scope }) => {
            setLock(scope);
            await expect(
                executeAppAction({
                    type: 'removeAutomationPoint',
                    payload: { laneId: TARGET, pointIndex: 0, pointId: 'unaffected-start' },
                })
            ).rejects.toSatisfy(isAppActionAdmissionRefusal);
            await executeAppAction(shapeAction());
            const inserted = readLane();
            expect(inserted).not.toEqual(initialPoints);
            expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: true });
            expect(readLane()).toStrictEqual(initialPoints);
            await redo({ stepOverConflicts: false });
            expect(readLane()).toStrictEqual(inserted);
        }
    );

    it('refuses replay when a lock later covers a replaced old beat outside the requested span', async () => {
        await executeAppAction(shapeAction());
        setLock({ kind: 'range', startBeat: 3.97, endBeat: 4 });
        const before = refusalState();

        expect(await undo({ stepOverConflicts: false })).toEqual({ headConsumed: false });

        expect(refusalState()).toEqual(before);
    });

    it.each(['follower', 'repair'] as const)(
        'refuses a %s without changing stacks or pending writes',
        async (state) => {
            await executeAppAction(pointAction());
            await undo({ stepOverConflicts: false });
            if (state === 'follower') {
                editRawLane((lane) => {
                    lane.linkedLaneId = OTHER;
                });
                projectCrdtToStores({ resetProjections: true });
            } else {
                agentProjectRepairStateStore.set({
                    audioGraphValid: false,
                    detectedRevision: 'repair-revision',
                    inspectionAvailable: true,
                    projectInvariantsValid: false,
                    rawProjectRetained: true,
                    repairCandidates: [],
                    status: 'repair-required',
                });
            }
            const before = refusalState();

            await expect(executeAppAction(shapeAction())).rejects.toSatisfy(isAppActionConflictError);

            expect(refusalState()).toEqual(before);
        }
    );

    it.each(['owner', 'raw points'] as const)('refuses a %s changed after admission', async (change) => {
        let changed: ReturnType<typeof refusalState> | undefined;

        await expect(
            executeAppAction(shapeAction(), {
                observeMaterializedAction: () => {
                    editRawLane((lane) => {
                        if (change === 'owner') {
                            lane.parameterId = 'different-parameter';
                        } else {
                            lane.points[0]!.value = 0.99;
                        }
                    });
                    changed = refusalState();
                },
            })
        ).rejects.toSatisfy(isAppActionConflictError);

        expect(changed).toBeDefined();
        expect(refusalState()).toEqual(changed);
    });

    it('refuses a captured Undo edit with the wrong direction or caller-supplied authority', async () => {
        await executeAppAction(shapeAction());
        const entry = readHistory()?.past.at(-1);
        if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'insertAutomationLanePoints') {
            throw new Error('Expected an Automation-owned inverse');
        }
        const before = refusalState();
        const copiedInverse = structuredClone(entry.inverseAction);

        await expect(executeAppAction(copiedInverse, { skipUndo: true, undoEntryId: entry.id })).rejects.toSatisfy(
            isAppActionConflictError
        );
        expect(refusalState()).toEqual(before);

        await expect(executeAppAction(structuredClone(entry.action))).rejects.toSatisfy(isAppActionConflictError);
        expect(refusalState()).toEqual(before);
    });

    it('drops a saved entry when its inverse capture addresses a different lane', async () => {
        await executeAppAction(shapeAction());
        const inserted = readLane();
        await persistCrdtProject();
        const witness = captureDurableDocumentWitness();
        const mirror: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
        if (!isRecord(mirror) || !Array.isArray(mirror.past)) {
            throw new Error('Expected the persisted session mirror');
        }
        const entry: unknown = mirror.past[0];
        if (!isRecord(entry) || !isRecord(entry.inverseAction) || !isRecord(entry.inverseAction.payload)) {
            throw new Error('Expected a persisted insertion inverse');
        }
        expect(mirror).toMatchObject({ projectId: PROJECT_ID, witness, future: [] });
        entry.inverseAction.payload.laneId = OTHER;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(mirror));

        registerCommands();

        expect(readHistory()).toMatchObject({ past: [], future: [] });
        expect(readLane()).toStrictEqual(inserted);
    });

    it('keeps local insertion out of provider discovery and macro recording and refuses batch siblings', async () => {
        expect(isExecutableAppActionType('insertAutomationLanePoints')).toBe(false);
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        await executeAppAction(shapeAction());
        expect(macroStore.value?.currentRecording).toEqual([]);
        const before = refusalState();

        const result = await executeAppActionBatch([pointAction(), shapeAction()]);

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Action must execute as a singleton batch: insertAutomationLanePoints',
            actions: [],
        });
        expect(refusalState()).toEqual(before);

        macroStore.set({
            macros: [
                {
                    id: 'imported-macro',
                    name: 'Stored insertion',
                    createdAt: 1,
                    actions: [
                        { type: 'setTrackColor', payload: { trackId: TRACK_ID, color: EDITED_COLOR } },
                        pointAction(),
                    ],
                },
            ],
            recording: false,
            currentRecording: [],
        });
        const beforeMacro = refusalState();
        await expect(executeAppAction({ type: 'playMacro', payload: { macroId: 'imported-macro' } })).rejects.toSatisfy(
            isAppActionConflictError
        );
        expect(refusalState()).toEqual(beforeMacro);
    });
});
