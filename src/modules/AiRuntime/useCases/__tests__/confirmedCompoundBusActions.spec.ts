import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
    undo,
    redo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { type ProjectContext } from '../../models/ProjectContext';
import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const runtimeMocks = vi.hoisted(() => ({
    addDeviceToStrip: vi.fn(),
    clearReportedLatency: vi.fn(),
    engineRemoveSend: vi.fn(),
    engineSetSend: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
    removeDeviceFromStrip: vi.fn(),
    removeTrackStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    addDeviceToStrip: runtimeMocks.addDeviceToStrip,
    clearReportedLatency: runtimeMocks.clearReportedLatency,
    removeDeviceFromStrip: runtimeMocks.removeDeviceFromStrip,
    removeTrackStrip: runtimeMocks.removeTrackStrip,
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
    removeSend: runtimeMocks.engineRemoveSend,
    setSend: runtimeMocks.engineSetSend,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const BUS_ID = 'bus-ai-00000000-0000-4000-8000-000000000001';
const BUS_ALTERNATIVE_ID = 'alternative-ai-00000000-0000-4000-8000-000000000001';

function createVocalsTrack(): Track {
    return {
        id: 'track-vocals',
        name: 'Vocals',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
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

function createCompoundActions(includeConflictingSend = false): ExecutableRuntimeAction[] {
    const actions: ExecutableRuntimeAction[] = [
        {
            type: 'createBus',
            payload: {
                name: 'Vocal Plate',
                busId: BUS_ID,
                initialAlternativeId: BUS_ALTERNATIVE_ID,
                color: '#7b61ff',
            },
        },
        {
            type: 'addDevice',
            payload: { trackId: BUS_ID, deviceType: 'builtin-reverb', expectedDeviceIds: [] },
        },
        {
            type: 'addSend',
            payload: {
                trackId: 'track-vocals',
                busId: BUS_ID,
                level: 0.25,
                expectedAbsent: true,
            },
        },
    ];
    if (includeConflictingSend) {
        actions.push({
            type: 'addSend',
            payload: {
                trackId: 'track-vocals',
                busId: BUS_ID,
                level: 0.5,
                expectedAbsent: true,
            },
        });
    }
    return actions;
}

function createRepeatedMuteCompilerContext(): ProjectContext {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 16,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 16,
        metronomeEnabled: false,
        metronomeVolume: 0.5,
        masterGain: 0.8,
        tracks: [
            {
                id: 'track-vocals',
                name: 'Vocals',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
                sends: [],
            },
        ],
        selectedTrackId: 'track-vocals',
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

function compileRepeatedMuteActions(): ExecutableRuntimeAction[] {
    const compilerContext = createRepeatedMuteCompilerContext();
    const result = compileArbitraryCommandList({
        context: compilerContext,
        revision: 'revision-repeated-mute',
        calls: [
            {
                name: 'command.batch.propose',
                arguments: {
                    plan: {
                        semantic: { classification: 'simple', uncertainty: [] },
                        objective: 'Mute vocals.',
                        constraints: [],
                        scope: {
                            targetIds: ['track-vocals'],
                            targetRanges: [],
                            protectedTargetIds: [],
                            protectedRanges: [],
                        },
                        capabilityIds: [],
                        assetIds: [],
                        alternatives: [],
                        validationStrategy: [],
                        stoppingConditions: [],
                    },
                    list: {
                        schemaVersion: 1,
                        items: [
                            {
                                id: 'mute-vocals',
                                name: 'muteTrack',
                                arguments: { muted: true },
                                selector: {
                                    targetArgument: 'trackId',
                                    entity: 'track',
                                    where: { name: 'Vocals' },
                                    quantity: { unit: 'targets', exactly: 1 },
                                },
                                repeat: { count: 2 },
                            },
                        ],
                    },
                },
            },
        ],
    });
    if (result.status !== 'accepted' || result.compilerEvidence === undefined) {
        throw new Error('Expected repeated mute command compilation.');
    }
    const unguardedActions = result.compilerEvidence.commands.map((command) => {
        if (
            command.name !== 'muteTrack' ||
            typeof command.arguments.trackId !== 'string' ||
            typeof command.arguments.muted !== 'boolean'
        ) {
            throw new Error('Expected canonical mute command.');
        }
        return {
            type: 'muteTrack' as const,
            payload: { trackId: command.arguments.trackId, muted: command.arguments.muted },
        };
    });
    const materialized = materializeActionStateGuards(unguardedActions, compilerContext);
    if (materialized.status !== 'accepted') {
        throw new Error(materialized.reason);
    }
    return materialized.actions;
}

function registerCanonicalMuteHandler(): void {
    clearHandlerRegistry();
    registerHandlerMap({
        muteTrack: {
            canReapplyAfterDivergence: () => true,
            validate: (action) =>
                trackStore.value?.tracks.find((track) => track.id === action.payload.trackId)?.muted ===
                action.payload.expectedMuted,
            execute: (action) => {
                const current = trackStore.value;
                const track = current?.tracks.find((candidate) => candidate.id === action.payload.trackId);
                if (!current || !track || track.muted !== action.payload.expectedMuted) {
                    return { status: 'conflict' };
                }
                trackStore.set({
                    ...current,
                    tracks: current.tracks.map((candidate) =>
                        candidate.id === track.id ? { ...candidate, muted: action.payload.muted } : candidate
                    ),
                });
                return { status: 'written' };
            },
            isNoop: () => false,
            describe: (action) => ({
                label: action.payload.muted ? 'Mute track' : 'Unmute track',
                inverseAction: {
                    type: 'muteTrack',
                    payload: {
                        trackId: action.payload.trackId,
                        muted: action.payload.expectedMuted,
                        expectedMuted: action.payload.muted,
                    },
                },
            }),
            undoable: true,
        },
    });
}

function propose(actions: ExecutableRuntimeAction[], id: string): void {
    const projectRevision = captureProjectRevision();
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: id,
        batchId: id,
        projectId: projectRevision,
        baseRevision: projectRevision,
        intent: 'create a Vocal Plate bus, add Reverb, and route Vocals to it',
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
                    options: { groupId: id, groupLabel: 'Create Vocal Plate bus', source: 'prompt' },
                })
            )
        ),
    });
    proposePendingActionConfirmation({
        id,
        prompt: 'create a Vocal Plate bus, add Reverb, and route Vocals to it',
        assistantMessageId: 'assistant-1',
        actions,
        actionLabels: actions.map((action) => action.type),
        commandBatch,
        agentApproval: compileAgentRiskApproval({ commandBatch }),
        executionMode: 'atomic',
        projectRevision,
    });
}

describe('confirmed compound bus actions', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('confirmed compound bus test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const vocals = createVocalsTrack();
        trackStore.set({ tracks: [vocals], selectedTrackId: vocals.id, ghostClips: [] });
        chatStore.set({
            messages: [{ id: 'assistant-1', role: 'assistant', content: 'Awaiting confirmation', timestamp: 1 }],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
    });

    afterEach(() => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('executes the confirmed materialized identity and undoes the whole group', async () => {
        const actions = createCompoundActions();
        propose(actions, 'confirmation-success');

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-success' })).resolves.toEqual({
            status: 'executed',
        });

        expect(getPendingActionConfirmation('confirmation-success')).toMatchObject({
            status: 'executed',
            actions,
        });
        const committedBus = trackStore.value?.tracks.find((track) => track.id === BUS_ID);
        expect(committedBus?.devices[0]?.type).toBe('builtin-reverb');
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.sends).toEqual([
            { busId: BUS_ID, level: 0.25, preFader: false },
        ]);
        expect(runtimeMocks.engineSetSend).toHaveBeenCalledWith('track-vocals', BUS_ID, 0.25, false);
        const undoEntries = undoStore.value?.past ?? [];
        expect(undoEntries).toHaveLength(3);

        await undo();

        expect(trackStore.value?.tracks.some((track) => track.id === BUS_ID)).toBe(false);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.sends).toEqual([]);
        expect(runtimeMocks.removeDeviceFromStrip).toHaveBeenCalledWith(BUS_ID, expect.any(String));
        expect(runtimeMocks.engineRemoveSend).toHaveBeenCalledWith('track-vocals', BUS_ID);
    });

    it('rejects a later dependent conflict before any project or runtime effect', async () => {
        propose(createCompoundActions(true), 'confirmation-conflict');

        const result = await confirmPendingChatActions({ confirmationId: 'confirmation-conflict' });

        expect(result.status).toBe('failed');
        expect(trackStore.value?.tracks.some((track) => track.id === BUS_ID)).toBe(false);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.sends).toEqual([]);
        expect(runtimeMocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(runtimeMocks.removeDeviceFromStrip).not.toHaveBeenCalled();
        expect(runtimeMocks.engineSetSend).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
        expect(getPendingActionConfirmation('confirmation-conflict')?.status).toBe('failed');
    });

    it('commits a compiler-canonical repeated write as one receipt and one undo-redo group', async () => {
        registerCanonicalMuteHandler();
        const actions = compileRepeatedMuteActions();
        expect(actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true, expectedMuted: false } },
        ]);
        propose(actions, 'confirmation-repeated-mute');

        await expect(confirmPendingChatActions({ confirmationId: 'confirmation-repeated-mute' })).resolves.toEqual({
            status: 'executed',
        });

        expect(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.muted).toBe(true);
        expect(getPendingActionConfirmation('confirmation-repeated-mute')).toMatchObject({
            status: 'executed',
            executedActions: [
                {
                    actionType: 'muteTrack',
                    affectedIds: ['track-vocals'],
                    outcome: 'committed',
                },
            ],
        });
        expect(undoStore.value?.past).toHaveLength(1);
        expect(aiActionHistoryStore.value?.groups).toHaveLength(1);

        await undo();
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.muted).toBe(false);
        await redo();
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.muted).toBe(true);
    });

    it('does not write a canonical repeated batch after a competing track update', async () => {
        registerCanonicalMuteHandler();
        const actions = compileRepeatedMuteActions();
        propose(actions, 'confirmation-repeated-mute-conflict');
        const vocals = trackStore.value?.tracks.find((track) => track.id === 'track-vocals');
        if (!vocals) {
            throw new Error('Expected vocals track.');
        }
        trackStore.set({ tracks: [{ ...vocals, muted: true }], selectedTrackId: vocals.id, ghostClips: [] });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-repeated-mute-conflict' })
        ).resolves.toMatchObject({ status: 'failed' });
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.muted).toBe(true);
        expect(undoStore.value?.past).toEqual([]);
        expect(aiActionHistoryStore.value?.groups).toEqual([]);
    });

    it('does not write a canonical repeated batch after its confirmation snapshot is stale', async () => {
        registerCanonicalMuteHandler();
        const actions = compileRepeatedMuteActions();
        propose(actions, 'confirmation-repeated-mute-stale');
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'root',
            changeFn: (document) => {
                document.collaboratorRevision = true;
            },
        });

        await expect(
            confirmPendingChatActions({ confirmationId: 'confirmation-repeated-mute-stale' })
        ).resolves.toMatchObject({ status: 'invalidated' });
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-vocals')?.muted).toBe(false);
        expect(undoStore.value?.past).toEqual([]);
        expect(aiActionHistoryStore.value?.groups).toEqual([]);
    });
});
