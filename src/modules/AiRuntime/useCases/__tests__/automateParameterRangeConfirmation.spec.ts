import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { captureCommandBatchPreflightState } from '#/app/captureCommandBatchPreflightState';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { markerStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack, getAutomationParameterRange, runtimeGraphTopology } from '#/modules/Arrangement/useCases';
import {
    configureRuntimeGraphProjectRevisionValidator,
    configureRuntimeGraphTopologyValidator,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    getAutomationHandlers,
    getAutomationValueAtBeat,
    setAutomationParameterRangeResolver,
} from '#/modules/Automation/useCases';
import { configureCollaborationAssetOwner } from '#/modules/Collaboration/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { parsePromptToActions } from '../parsePromptToActions';

import {
    configureAiWorkflowCommandCheckpointRuntime,
    resetAiWorkflowCommandCheckpointRuntime,
} from './aiWorkflowCommandCheckpointRuntime';
import {
    discoverSearchedCalls,
    proposeDiscoveredCalls,
    scriptProviderTurns,
    searchCalls,
} from './highLevelIntentWorkflowFixture';

const runtimeMocks = vi.hoisted(() => ({ generateWebLlmCompletion: vi.fn(), updateDeviceParam: vi.fn() }));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => ['webllm'],
}));
vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'webllm',
}));
vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));
vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({ isWebLlmLoaded: () => true }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const PROMPT = 'dip the lead vocal by 6 dB in the second chorus';
const VOCAL_ID = 'track-lead-vocal';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function leadVocal(): Track {
    return { ...createTrack({ id: VOCAL_ID, name: 'Lead Vocal', kind: 'audio', withoutDefaultDevice: true }), gain: 1 };
}

function seedProject(): void {
    trackStore.set({ tracks: [leadVocal()], selectedTrackId: null, ghostClips: [] });
    markerStore.set({
        markers: [],
        sections: [
            { id: 'section-verse', name: 'Verse', startBeat: 0, endBeat: 16, color: '#000000' },
            { id: 'section-chorus-one', name: 'Chorus', startBeat: 16, endBeat: 32, color: '#000000' },
            { id: 'section-chorus-two', name: 'Chorus', startBeat: 32, endBeat: 48, color: '#000000' },
        ],
    });
    automationStore.set({ lanes: [] });
    flushAutomergeStorageWrites();
}

/** The hosted model's turns: search the index, discover the range command, propose the dip. */
function scriptDipProposal(): void {
    scriptProviderTurns(runtimeMocks.generateWebLlmCompletion, [
        () => searchCalls(['dip a track level across a section']),
        discoverSearchedCalls(['automateParameterRange']),
        proposeDiscoveredCalls(
            [
                {
                    id: 'dip-vocal',
                    name: 'automateParameterRange',
                    arguments: {
                        parameterId: 'gain',
                        range: { section: 'second chorus' },
                        deltaDb: -6,
                        rampIn: 0.5,
                        rampOut: 0.5,
                    },
                    selector: {
                        targetArgument: 'trackId',
                        entity: 'track',
                        where: { name: 'Lead Vocal' },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                },
            ],
            ['automateParameterRange']
        ),
    ]);
}

/** Proposes the planned batch the way the chat does and approves it. */
async function approve(actions: ExecutableRuntimeAction[], id: string) {
    const projectRevision = captureProjectRevision();
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: id,
        batchId: id,
        projectId: captureProjectIdentity(),
        baseRevision: projectRevision,
        intent: PROMPT,
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
                    options: { groupId: id, groupLabel: 'Dip the lead vocal', source: 'prompt' },
                })
            )
        ),
    });
    proposePendingActionConfirmation({
        id,
        prompt: PROMPT,
        assistantMessageId: 'assistant-1',
        actions,
        actionLabels: actions.map((action) => action.type),
        commandBatch,
        agentApproval: compileAgentRiskApproval({ commandBatch }),
        executionMode: 'atomic',
        projectRevision,
    });
    return confirmPendingChatActions({ confirmationId: id });
}

describe('an approved range write from a planned request', () => {
    beforeEach(() => {
        configureAiWorkflowCommandCheckpointRuntime();
        runtimeMocks.generateWebLlmCompletion.mockReset();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('automate parameter range confirmation test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        commandBatchPreflightPort.setProvider(captureCommandBatchPreflightState);
        configureCollaborationAssetOwner({ captureOwnerId: () => 'project:automate-parameter-range' });
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
        markerStore.set({ markers: [], sections: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('dips the vocal across exactly the second chorus with short ramps, and one undo restores the lane', async () => {
        scriptDipProposal();
        const planned = await parsePromptToActions(PROMPT, getProjectContext(), undefined, captureProjectRevision());
        expect(planned.planningOutcome).toEqual({ kind: 'proposal' });

        await expect(approve(planned.actions, 'confirmation-dip')).resolves.toEqual({ status: 'executed' });

        const lane = automationStore.value?.lanes.find(
            (candidate) => candidate.trackId === VOCAL_ID && candidate.parameterId === 'gain'
        );
        const dipped = dbToGain(-6);
        expect(lane?.points.map(({ beat, value }) => ({ beat, value }))).toEqual([
            { beat: 32, value: 1 },
            { beat: 32.5, value: dipped },
            { beat: 47.5, value: dipped },
            { beat: 48, value: 1 },
        ]);
        const laneId = lane?.id ?? '';
        expect([0, 16, 31.75, 48, 64].map((beat) => getAutomationValueAtBeat(laneId, beat))).toEqual([1, 1, 1, 1, 1]);
        expect(getAutomationValueAtBeat(laneId, 40)).toBeCloseTo(dipped, 12);

        await undo();

        expect(automationStore.value?.lanes).toEqual([]);
    });
});
