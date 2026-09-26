import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureCommandBatchPreflightState } from '#/app/captureCommandBatchPreflightState';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Device, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getAutomationParameterRange, runtimeGraphTopology } from '#/modules/Arrangement/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { type AutomationLane, automationStore } from '#/modules/Automation/stores';
import {
    addAutomationLane as addLaneAsUser,
    addAutomationPoint as addPointAsCollaborator,
    createAutomationLane,
    getAutomationHandlers,
    getAutomationValueAtBeat,
    removeAutomationLane as removeLaneAsUser,
    setAutomationParameterRangeResolver,
    updateAutomationPoint as updatePointAsCollaborator,
} from '#/modules/Automation/useCases';
import { configureCollaborationAssetOwner } from '#/modules/Collaboration/useCases';
import {
    clearHandlerRegistry,
    macroStore,
    registerHandlerMap,
    undoHistoryStore,
    undoStore,
} from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    compileVersionedCommandBatchEnvelope,
    executeAppAction,
    executeAppActionBatch,
    executeVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    redo,
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { FADER_MAX_GAIN, gainLaneLevelLaw, resolveLevelFields } from '#/utils/audioLevelLaw';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { materializeBatchLocalActionIdentities } from '../agentReference/materializeBatchLocalActionIdentities';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

import {
    configureAiWorkflowCommandCheckpointRuntime,
    resetAiWorkflowCommandCheckpointRuntime,
} from './aiWorkflowCommandCheckpointRuntime';

const runtimeMocks = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
}));

const notificationMocks = vi.hoisted(() => ({
    notifyUser: vi.fn<(message: string, level?: string) => void>(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: notificationMocks.notifyUser,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const TRACK_ID = 'track-vocals';
const LANE_ID = 'automation-ai-00000000-0000-4000-8000-000000000001';
const UNKNOWN_LANE_ID = 'automation-ai-00000000-0000-4000-8000-000000000999';
const EXISTING_GAIN_LANE_ID = 'lane-vocals-gain';
const FOLLOWED_LANE_ID = 'lane-vocals-pan';
const FOLLOWER_LANE_ID = 'lane-vocals-pan-follower';
const PRIOR_LANE_ID = 'lane-vocals-prior-pan';
const USER_GAIN_LANE_ID = 'lane-vocals-user-gain';
const COLLABORATOR_POINT_ID = 'collab-point';
const DRIVE_TARGET = 'device-drive:dist-drive';
const BATCH_LABEL = 'automate the Vocals track and write its points';
const CONFLICT_NOTICE = `Cannot undo "${BATCH_LABEL}": project state has changed`;
const STEP_OVER_NOTICE = `Skipped "${BATCH_LABEL}": project state has changed; undid "${BATCH_LABEL}"`;

const DRIVE_DEVICE: Device = {
    id: 'device-drive',
    name: 'Distortion',
    type: 'builtin-distortion',
    bypassed: false,
    parameterValues: { 'dist-drive': 20 },
};

const PHASER_DEVICE: Device = {
    id: 'device-phaser',
    name: 'Phaser',
    type: 'builtin-phaser',
    bypassed: false,
    parameterValues: { 'phaser-stages': 4 },
};

const planDocument = {
    semantic: { classification: 'simple', uncertainty: [] },
    objective: 'Create one automation lane on the Vocals track and write its points.',
    constraints: [],
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: [],
    stoppingConditions: [],
};

const vocalsSelector = {
    targetArgument: 'trackId',
    entity: 'track',
    where: { name: 'Vocals' },
    quantity: { unit: 'targets', exactly: 1 },
};

function createVocalsTrack(devices: Device[]): Track {
    return {
        id: TRACK_ID,
        name: 'Vocals',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices,
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function seedProject(lanes: AutomationLane[] = []): void {
    const vocals = createVocalsTrack([DRIVE_DEVICE, PHASER_DEVICE]);
    trackStore.set({ tracks: [vocals], selectedTrackId: vocals.id, ghostClips: [] });
    automationStore.set({ lanes });
    flushAutomergeStorageWrites();
}

function createStoredLane(input: {
    id: string;
    parameterId: string;
    parameterName: string;
    linkedLaneId?: string;
}): AutomationLane {
    const lane: AutomationLane = {
        ...createAutomationLane(TRACK_ID, input.parameterId, input.parameterName, 0, FADER_MAX_GAIN),
        id: input.id,
        points: [{ id: `${input.id}-point`, beat: 4, value: 0.8, curve: 'linear', tension: 0 }],
    };
    if (input.linkedLaneId !== undefined) {
        lane.linkedLaneId = input.linkedLaneId;
    }
    return lane;
}

function addLane(parameterId: string, parameterName: string, laneId: string = LANE_ID): ExecutableRuntimeAction {
    return { type: 'addAutomationLane', payload: { trackId: TRACK_ID, parameterId, parameterName, laneId } };
}

function addPoint(
    laneId: string,
    beat: number,
    level: { value: number } | { valueDb: number }
): ExecutableRuntimeAction {
    return { type: 'addAutomationPoint', payload: { laneId, beat, ...level } };
}

function projectSnapshot(): string {
    return JSON.stringify(getCrdtDoc('root'));
}

function findLane(laneId: string): AutomationLane | undefined {
    return automationStore.value?.lanes.find((lane) => lane.id === laneId);
}

function notices(): string[] {
    return notificationMocks.notifyUser.mock.calls.map(([message]) => message);
}

function undoGroupIds(stack: 'past' | 'future'): (string | undefined)[] {
    return (undoHistoryStore.value?.[stack] ?? []).map((entry) => entry.groupId);
}

/** The lane removal undoing the newest batch runs, with the batch context it runs in: newest inverse first. */
function getUndoLaneRemoval() {
    const past = undoHistoryStore.value?.past ?? [];
    const groupId = past.at(-1)?.groupId;
    const inverses = past
        .filter((entry) => groupId !== undefined && entry.groupId === groupId)
        .reverse()
        .flatMap((entry) => (entry.kind === 'action' && entry.inverseAction ? [entry.inverseAction] : []));
    const actionIndex = inverses.findIndex((inverse) => inverse.type === 'removeAutomationLane');
    const removal = inverses[actionIndex];
    if (removal?.type !== 'removeAutomationLane') {
        throw new Error('Expected undoing the batch to remove its lane');
    }
    return { removal, context: { actions: inverses, actionIndex } };
}

function gainAtDecibels(db: number): number {
    const resolved = resolveLevelFields(
        { absoluteDb: db },
        0,
        gainLaneLevelLaw({ minValue: 0, maxValue: FADER_MAX_GAIN })
    );
    if (!resolved.ok) {
        throw new Error(resolved.reason);
    }
    return resolved.linear;
}

function propose(actions: ExecutableRuntimeAction[], id: string): void {
    const projectRevision = captureProjectRevision();
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: id,
        batchId: id,
        projectId: captureProjectIdentity(),
        baseRevision: projectRevision,
        intent: 'automate the Vocals track and write its points',
        dynamicEffects: {
            affectedTrackIds: [],
            affectedClipIds: [],
            affectedTargetIds: [],
            automationPoints: 0,
            deletedObjects: 0,
        },
        commands: actions.map((action) =>
            serializeVersionedCommandEnvelope(
                migrateLegacyAppActionToVersionedCommandEnvelope({
                    action,
                    expectedEffect: action.type,
                    normalizedProjectRevision: projectRevision,
                    options: { groupId: id, groupLabel: 'Automate Vocals', source: 'prompt' },
                })
            )
        ),
    });
    proposePendingActionConfirmation({
        id,
        prompt: 'automate the Vocals track and write its points',
        assistantMessageId: 'assistant-1',
        actions,
        actionLabels: actions.map((action) => action.type),
        commandBatch,
        agentApproval: compileAgentRiskApproval({ commandBatch }),
        executionMode: 'atomic',
        projectRevision,
    });
}

async function confirm(actions: ExecutableRuntimeAction[], id: string) {
    propose(actions, id);
    return confirmPendingChatActions({ confirmationId: id });
}

function compileProviderPlan(prompt: string, items: readonly unknown[]) {
    const context = getProjectContext();
    const revision = captureProjectRevision();
    const compiled = compileArbitraryCommandList({
        context,
        revision,
        calls: [
            { name: 'command.batch.propose', arguments: { plan: planDocument, list: { schemaVersion: 1, items } } },
        ],
    });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        throw new Error(compiled.status === 'rejected' ? compiled.reason : 'Expected compiler evidence');
    }
    const bridged = bridgeGroundedLlmToolCalls({
        calls: compiled.compilerEvidence.commands,
        compilerEvidence: compiled.compilerEvidence,
        context,
        projectRevision: revision,
        prompt,
    });
    return { bridged, context, prompt, revision };
}

describe('automation lane binding in one agent batch', () => {
    beforeEach(() => {
        configureAiWorkflowCommandCheckpointRuntime();
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('automation lane binding test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        commandBatchPreflightPort.setProvider(captureCommandBatchPreflightState);
        configureCollaborationAssetOwner({ captureOwnerId: () => 'project:automation-lane-binding' });
        configureRuntimeGraphProjectRevisionValidator(
            (expectedProjectRevision) => captureProjectRevision() === expectedProjectRevision
        );
        configureRuntimeGraphTopologyValidator(runtimeGraphTopology.matchesCurrentProject);
        setAutomationParameterRangeResolver(getAutomationParameterRange);
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        seedProject();
        chatStore.set({
            messages: [{ id: 'assistant-1', role: 'assistant', content: 'Awaiting confirmation', timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
    });

    afterEach(() => {
        resetAiWorkflowCommandCheckpointRuntime();
        commandBatchPreflightPort.setProvider(null);
        configureRuntimeGraphProjectRevisionValidator(null);
        configureRuntimeGraphTopologyValidator(null);
        setAutomationParameterRangeResolver(null);
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        automationStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('creates a gain lane and writes its decibel points as one batch that one undo removes and redo restores', async () => {
        const actions = [
            addLane('gain', 'Gain'),
            addPoint(LANE_ID, 0, { valueDb: -6 }),
            addPoint(LANE_ID, 16, { valueDb: 0 }),
        ];

        await expect(confirm(actions, 'confirmation-gain-lane')).resolves.toEqual({ status: 'executed' });

        expect(getPendingActionConfirmation('confirmation-gain-lane')?.status).toBe('executed');
        expect(aiActionHistoryStore.value?.groups).toHaveLength(1);
        const lane = findLane(LANE_ID);
        expect(lane).toMatchObject({
            trackId: TRACK_ID,
            parameterId: 'gain',
            parameterName: 'Gain',
            minValue: 0,
            maxValue: FADER_MAX_GAIN,
        });
        expect(lane?.points.map((point) => point.beat)).toEqual([0, 16]);
        expect(lane?.points.map((point) => point.id)).toEqual([expect.any(String), expect.any(String)]);
        expect(getAutomationValueAtBeat(LANE_ID, 0)).toBeCloseTo(gainAtDecibels(-6), 12);
        expect(getAutomationValueAtBeat(LANE_ID, 16)).toBeCloseTo(gainAtDecibels(0), 12);
        const committedLanes = structuredClone(automationStore.value?.lanes);

        await undo();

        expect(automationStore.value?.lanes).toEqual([]);

        await redo();

        expect(automationStore.value?.lanes).toEqual(committedLanes);
    });

    it('creates a lane on an automatable device parameter with its descriptor range and native point values', async () => {
        const actions = [
            addLane(DRIVE_TARGET, 'Distortion → Drive'),
            addPoint(LANE_ID, 0, { value: 25 }),
            addPoint(LANE_ID, 16, { value: 75 }),
        ];

        await expect(confirm(actions, 'confirmation-drive-lane')).resolves.toEqual({ status: 'executed' });

        expect(findLane(LANE_ID)).toMatchObject({
            trackId: TRACK_ID,
            parameterId: DRIVE_TARGET,
            parameterName: 'Distortion → Drive',
            minValue: 0,
            maxValue: 100,
        });
        expect(getAutomationValueAtBeat(LANE_ID, 0)).toBe(25);
        expect(getAutomationValueAtBeat(LANE_ID, 16)).toBe(75);
        const committedLanes = structuredClone(automationStore.value?.lanes);

        await undo();

        expect(automationStore.value?.lanes).toEqual([]);

        await redo();

        expect(automationStore.value?.lanes).toEqual(committedLanes);
    });

    it('refuses decibels on a device parameter lane before any write', async () => {
        const documentBefore = projectSnapshot();
        const decibelsOnDriveLane = () => [
            addLane(DRIVE_TARGET, 'Distortion → Drive'),
            addPoint(LANE_ID, 0, { valueDb: -6 }),
        ];
        const laneWrites: string[][] = [];
        const unsubscribe = automationStore.subscribe(() => {
            laneWrites.push(automationStore.value?.lanes.map((lane) => lane.id) ?? []);
        });

        // Validation names the owner's reason before the lane is created, so no member executes
        // and nothing has to be compensated.
        const refused = await executeAppActionBatch(decibelsOnDriveLane());
        unsubscribe();

        expect(refused).toMatchObject({
            status: 'conflicted',
            reason: expect.stringContaining('Lane "Distortion → Drive" does not hold gain amplitudes'),
        });
        expect(laneWrites).toEqual([]);

        const result = await confirm(decibelsOnDriveLane(), 'confirmation-drive-decibels');

        expect(result).toMatchObject({ status: 'failed' });
        expect(JSON.stringify(result)).toContain('does not hold gain amplitudes');
        expect(projectSnapshot()).toBe(documentBefore);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('refuses a lane on a track the project does not hold and writes no lane', async () => {
        const documentBefore = projectSnapshot();

        const refused = await executeAppActionBatch([
            {
                type: 'addAutomationLane',
                payload: { trackId: 'track-missing', parameterId: 'gain', parameterName: 'Gain', laneId: LANE_ID },
            },
        ]);

        expect(refused).toMatchObject({
            status: 'conflicted',
            reason: expect.stringContaining('Track is unavailable: track-missing'),
        });
        expect(automationStore.value?.lanes).toEqual([]);
        expect(projectSnapshot()).toBe(documentBefore);
        expect(undoStore.value?.past).toEqual([]);
    });

    it.each([
        { label: 'a device parameter no curve may drive', target: 'device-phaser:phaser-stages' },
        { label: 'a device the track does not carry', target: 'device-missing:dist-drive' },
        { label: 'a parameter the device does not have', target: 'device-drive:no-such-parameter' },
    ])('refuses the whole batch for $label', async ({ target }) => {
        const documentBefore = projectSnapshot();

        const result = await confirm([addLane(target, 'Target'), addPoint(LANE_ID, 0, { value: 3 })], 'refused-target');

        expect(result).toMatchObject({ status: 'failed' });
        expect(JSON.stringify(result)).toContain(`Parameter ${target} is not an automatable target`);
        expect(projectSnapshot()).toBe(documentBefore);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });

    // The confirmed route stops both batches before any write: an unknown lane is no target the
    // envelope can resolve, and a point ahead of its lane has no inverse to compensate with. The
    // handler's own refusal is what an unconfirmed batch meets, so it is pinned on that route too.
    it.each([
        {
            label: 'names a lane nothing creates',
            laneId: UNKNOWN_LANE_ID,
            actions: [addLane('gain', 'Gain'), addPoint(UNKNOWN_LANE_ID, 0, { value: 0.5 })],
            confirmedRefusal: `Command batch target does not exist: ${UNKNOWN_LANE_ID}`,
        },
        {
            label: 'precedes the member creating its lane',
            laneId: LANE_ID,
            actions: [addPoint(LANE_ID, 0, { value: 0.5 }), addLane('gain', 'Gain')],
            confirmedRefusal: 'Action is not compensable inside an atomic batch: addAutomationPoint',
        },
    ])('refuses a point that $label', async ({ laneId, actions, confirmedRefusal }) => {
        const documentBefore = projectSnapshot();
        const refusal = `Automation lane ${laneId} is neither in the project nor created earlier in this batch.`;

        const result = await confirm(actions, 'refused-point');

        expect(result).toEqual({ status: 'failed', reason: confirmedRefusal });
        expect(projectSnapshot()).toBe(documentBefore);
        expect(automationStore.value?.lanes).toEqual([]);
        await expect(executeAppActionBatch(actions)).resolves.toMatchObject({
            status: 'conflicted',
            reason: expect.stringContaining(refusal),
        });
        expect(projectSnapshot()).toBe(documentBefore);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('refuses a new lane for a track parameter that already has one, naming the existing lane', async () => {
        seedProject([createStoredLane({ id: EXISTING_GAIN_LANE_ID, parameterId: 'gain', parameterName: 'Gain' })]);
        const documentBefore = projectSnapshot();
        const lanesBefore = structuredClone(automationStore.value?.lanes);

        const result = await confirm(
            [addLane('gain', 'Gain'), addPoint(LANE_ID, 0, { valueDb: -6 })],
            'confirmation-existing-gain'
        );

        expect(result).toMatchObject({ status: 'failed' });
        expect(JSON.stringify(result)).toContain(`on lane ${EXISTING_GAIN_LANE_ID}`);
        expect(projectSnapshot()).toBe(documentBefore);
        expect(automationStore.value?.lanes).toEqual(lanesBefore);
    });

    it('leaves no lane, no point and the same undo history when a later member fails at execute', async () => {
        await executeAppAction(addLane('pan', 'Pan', PRIOR_LANE_ID));
        flushAutomergeStorageWrites();
        const documentBefore = projectSnapshot();
        const lanesBefore = structuredClone(automationStore.value?.lanes);
        const undoBefore = structuredClone(undoStore.value?.past);
        expect(undoBefore).toHaveLength(1);

        const result = await confirm(
            [addLane('gain', 'Gain'), addPoint(LANE_ID, 0, { valueDb: -6 }), addPoint(LANE_ID, 16, { valueDb: 50 })],
            'confirmation-execute-failure'
        );

        expect(result).toMatchObject({ status: 'failed' });
        expect(JSON.stringify(result)).toContain("above this control's ceiling");
        expect(findLane(LANE_ID)).toBeUndefined();
        expect(automationStore.value?.lanes).toEqual(lanesBefore);
        expect(projectSnapshot()).toBe(documentBefore);
        expect(undoStore.value?.past).toEqual(undoBefore);
        expect(aiActionHistoryStore.value?.groups).toEqual([]);
    });

    it('still refuses a point on a linked follower lane inside a multi-command batch', async () => {
        seedProject([
            createStoredLane({ id: FOLLOWED_LANE_ID, parameterId: 'pan', parameterName: 'Pan' }),
            createStoredLane({
                id: FOLLOWER_LANE_ID,
                parameterId: DRIVE_TARGET,
                parameterName: 'Distortion → Drive',
                linkedLaneId: FOLLOWED_LANE_ID,
            }),
        ]);
        const documentBefore = projectSnapshot();

        const result = await confirm(
            [
                addLane('gain', 'Gain'),
                addPoint(LANE_ID, 0, { value: 0.5 }),
                addPoint(FOLLOWER_LANE_ID, 8, { value: 0.2 }),
            ],
            'confirmation-follower'
        );

        expect(result).toMatchObject({ status: 'failed' });
        expect(JSON.stringify(result)).toContain(`follows automation lane ${FOLLOWED_LANE_ID}`);
        expect(projectSnapshot()).toBe(documentBefore);
        expect(findLane(LANE_ID)).toBeUndefined();
    });

    it('steps undo over a batch whose lane the user already removed and still undoes the entry beneath', async () => {
        await expect(confirm([addLane('pan', 'Pan', PRIOR_LANE_ID)], 'confirmation-prior-pan')).resolves.toEqual({
            status: 'executed',
        });
        await expect(
            confirm(
                [addLane('gain', 'Gain'), addPoint(LANE_ID, 0, { valueDb: -6 }), addPoint(LANE_ID, 16, { valueDb: 0 })],
                'confirmation-gain-lane'
            )
        ).resolves.toEqual({ status: 'executed' });
        const [priorGroupId, ...batchGroupIds] = undoGroupIds('past');
        expect(batchGroupIds).toHaveLength(3);
        expect(new Set([priorGroupId, ...batchGroupIds]).size).toBe(2);
        removeLaneAsUser(LANE_ID);
        flushAutomergeStorageWrites();

        await undo();

        // The batch's point inverses refuse with its lane, so nothing of the batch is written back
        // and the batch stays at the head, retryable, while the entry beneath is undone.
        expect(notices()).toEqual([CONFLICT_NOTICE, STEP_OVER_NOTICE]);
        expect(automationStore.value?.lanes).toEqual([]);
        expect(undoGroupIds('past')).toEqual(batchGroupIds);
        expect(undoGroupIds('future')).toEqual([priorGroupId]);
    });

    it('steps undo over a redone batch lane that folded into the lane the user created meanwhile', async () => {
        await expect(confirm([addLane('pan', 'Pan', PRIOR_LANE_ID)], 'confirmation-prior-pan')).resolves.toEqual({
            status: 'executed',
        });
        await expect(confirm([addLane('gain', 'Gain')], 'confirmation-gain-lane')).resolves.toEqual({
            status: 'executed',
        });
        const [priorGroupId, batchGroupId] = undoGroupIds('past');
        await undo();
        expect(findLane(LANE_ID)).toBeUndefined();
        addLaneAsUser(TRACK_ID, 'gain', 'Gain', USER_GAIN_LANE_ID);
        flushAutomergeStorageWrites();
        const userLane = structuredClone(findLane(USER_GAIN_LANE_ID));
        expect(userLane).toMatchObject({ trackId: TRACK_ID, parameterId: 'gain' });

        await redo();

        expect(findLane(LANE_ID)).toBeUndefined();
        expect(findLane(USER_GAIN_LANE_ID)).toEqual(userLane);
        expect(undoGroupIds('past')).toEqual([priorGroupId, batchGroupId]);

        await undo();

        expect(findLane(USER_GAIN_LANE_ID)).toEqual(userLane);
        expect(findLane(PRIOR_LANE_ID)).toBeUndefined();
        expect(notices()).toEqual([CONFLICT_NOTICE, STEP_OVER_NOTICE]);
        expect(undoGroupIds('past')).toEqual([batchGroupId]);
    });

    it('keeps the lane and a collaborator point on it when undoing the batch that created the lane', async () => {
        await expect(
            confirm(
                [addLane('gain', 'Gain'), addPoint(LANE_ID, 0, { valueDb: -6 }), addPoint(LANE_ID, 16, { valueDb: 0 })],
                'confirmation-gain-lane'
            )
        ).resolves.toEqual({ status: 'executed' });
        addPointAsCollaborator(LANE_ID, {
            id: COLLABORATOR_POINT_ID,
            beat: 8,
            value: 0.5,
            curve: 'linear',
            tension: 0,
        });
        flushAutomergeStorageWrites();
        const divergedLanes = structuredClone(automationStore.value?.lanes);
        expect(findLane(LANE_ID)?.points.map((point) => point.beat)).toEqual([0, 8, 16]);
        const { removal, context } = getUndoLaneRemoval();

        expect(getAutomationHandlers().removeAutomationLane.canReapplyAfterDivergence?.(removal, context)).toBe(false);

        await undo();

        expect(automationStore.value?.lanes).toEqual(divergedLanes);
        expect(notices()).toEqual([CONFLICT_NOTICE]);
        expect(undoGroupIds('past')).toHaveLength(3);
    });

    it('still removes the lane when undoing after a collaborator edited only the points the batch created', async () => {
        await expect(
            confirm(
                [addLane('gain', 'Gain'), addPoint(LANE_ID, 0, { valueDb: -6 }), addPoint(LANE_ID, 16, { valueDb: 0 })],
                'confirmation-gain-lane'
            )
        ).resolves.toEqual({ status: 'executed' });
        updatePointAsCollaborator(LANE_ID, 16, 0.25);
        flushAutomergeStorageWrites();
        expect(getAutomationValueAtBeat(LANE_ID, 16)).toBe(0.25);
        const { removal, context } = getUndoLaneRemoval();

        expect(getAutomationHandlers().removeAutomationLane.canReapplyAfterDivergence?.(removal, context)).toBe(true);

        await undo();

        expect(automationStore.value?.lanes).toEqual([]);
        expect(notices()).toEqual([]);
        expect(undoGroupIds('past')).toEqual([]);
    });

    it('plans a bound gain lane with decibel points and commits it through the planner route', async () => {
        const planned = compileProviderPlan(
            'Automate track volume on Vocals, add automation point at beat 0 at -6 dB, then add automation point at beat 16 at 0 dB.',
            [
                {
                    id: 'make-lane',
                    name: 'addAutomationLane',
                    arguments: { parameterId: 'gain', binding: 'vox-gain' },
                    selector: vocalsSelector,
                },
                {
                    id: 'point-start',
                    name: 'addAutomationPoint',
                    arguments: { laneId: '$vox-gain', beat: 0, valueDb: -6 },
                    dependsOn: ['make-lane'],
                },
                {
                    id: 'point-end',
                    name: 'addAutomationPoint',
                    arguments: { laneId: '$vox-gain', beat: 16, valueDb: 0 },
                    dependsOn: ['make-lane'],
                },
            ]
        );
        expect(planned.bridged.rejections).toEqual([]);
        const identified = materializeBatchLocalActionIdentities(
            planned.bridged.actions,
            planned.bridged.batchLocalActionIdentities ?? []
        );
        if (identified.status !== 'accepted') {
            throw new Error(identified.reason);
        }
        const guarded = materializeActionStateGuards(identified.actions, planned.context);
        if (guarded.status !== 'accepted') {
            throw new Error(guarded.reason);
        }
        const [laneAction, startAction, endAction] = guarded.actions;
        if (
            laneAction?.type !== 'addAutomationLane' ||
            startAction?.type !== 'addAutomationPoint' ||
            endAction?.type !== 'addAutomationPoint'
        ) {
            throw new Error('Expected the lane, start point, end point action sequence');
        }
        expect(laneAction.payload).toMatchObject({
            trackId: TRACK_ID,
            parameterId: 'gain',
            parameterName: 'Gain',
            laneId: expect.stringMatching(/^automation-ai-/u),
        });
        expect(startAction.payload).toMatchObject({ laneId: laneAction.payload.laneId, beat: 0, valueDb: -6 });
        expect(endAction.payload).toMatchObject({ laneId: laneAction.payload.laneId, beat: 16, valueDb: 0 });
        if (planned.bridged.actionCommandGraph === undefined) {
            throw new Error('Expected an action command graph');
        }

        const commandBatch = compilePlannedActionCommandBatch({
            actions: guarded.actions,
            actionCommandGraph: planned.bridged.actionCommandGraph,
            actionLabels: guarded.actions.map((action) => action.type),
            autoCommit: true,
            autoCommitApproval: () => ({ status: 'valid' as const }),
            context: planned.context,
            group: { groupId: 'group-planned-gain-lane', groupLabel: 'Automate Vocals gain' },
            intent: planned.prompt,
            mode: 'commit',
            projectRevision: planned.revision,
            runId: 'run-planned-gain-lane',
        }).commandBatch;
        const committed = await executeVersionedCommandBatchEnvelope(commandBatch);
        expect(committed, JSON.stringify(committed)).toMatchObject({ status: 'committed' });

        const laneId = laneAction.payload.laneId ?? '<missing-lane-id>';
        expect(findLane(laneId)?.points.map((point) => point.beat)).toEqual([0, 16]);
        expect(getAutomationValueAtBeat(laneId, 0)).toBeCloseTo(gainAtDecibels(-6), 12);
        const committedLanes = structuredClone(automationStore.value?.lanes);

        await undo();

        expect(automationStore.value?.lanes).toEqual([]);

        await redo();

        expect(automationStore.value?.lanes).toEqual(committedLanes);
    });

    it('grounds a native value on a planned device parameter lane and refuses decibels on it', () => {
        const planDriveLane = (level: string, point: { value: number } | { valueDb: number }) =>
            compileProviderPlan(
                `Add automation lane for Distortion Drive on Vocals, add automation point at beat 0 at ${level}.`,
                [
                    {
                        id: 'make-lane',
                        name: 'addAutomationLane',
                        arguments: { parameterId: DRIVE_TARGET, binding: 'vox-drive' },
                        selector: vocalsSelector,
                    },
                    {
                        id: 'point-start',
                        name: 'addAutomationPoint',
                        arguments: { laneId: '$vox-drive', beat: 0, ...point },
                        dependsOn: ['make-lane'],
                    },
                ]
            );

        const native = planDriveLane('25', { value: 25 });
        const decibels = planDriveLane('-6 dB', { valueDb: -6 });

        expect(native.bridged.rejections).toEqual([]);
        expect(native.bridged.actions).toEqual([
            {
                type: 'addAutomationLane',
                payload: { trackId: TRACK_ID, parameterId: DRIVE_TARGET, parameterName: 'Distortion → Drive' },
            },
            {
                type: 'addAutomationPoint',
                payload: { laneId: expect.stringMatching(/^automation-ai-/u), beat: 0, value: 25 },
            },
        ]);
        expect(decibels.bridged.actions).toEqual([]);
        expect(decibels.bridged.rejections).toEqual([
            {
                index: 1,
                name: 'addAutomationPoint',
                reason: 'Expected an existing automation lane, an unused non-negative beat, and a value within lane bounds',
            },
        ]);
        expect(automationStore.value?.lanes).toEqual([]);
    });
});
