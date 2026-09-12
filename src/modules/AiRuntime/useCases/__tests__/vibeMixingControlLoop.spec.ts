import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { readAgentRunState } from '../../stores/agentRunStore';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    pendingActionConfirmationStore,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage as sendChatMessageWithoutDocumentFlush } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const PROMPT =
    'Set Lead Vocal gain to 70%, pan Guitar Left 20% left and Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.';

const PROVIDER_PLAN = [
    { name: 'setTrackGain', arguments: { trackId: 'track-lead-vocal', gain: 0.7 } },
    { name: 'setTrackPan', arguments: { trackId: 'track-guitar-left', pan: -20 } },
    { name: 'setTrackPan', arguments: { trackId: 'track-guitar-right', pan: 20 } },
    { name: 'muteTrack', arguments: { trackId: 'track-room-mic', muted: true } },
] as const;

const runtimeMocks = vi.hoisted(() => ({
    fetch: vi.fn<typeof fetch>(),
    generateWebLlmCompletion: vi.fn(),
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackPan: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => ['webllm'],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'webllm',
}));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackMute: runtimeMocks.setTrackMute,
    setTrackPan: runtimeMocks.setTrackPan,
    setTrackSoloGate: runtimeMocks.setTrackSoloGate,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function createTrack(id: string, name: string): Track {
    return {
        id,
        name,
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

/**
 * A provider that never stops proposing: it answers catalog discovery once and then returns a fresh
 * command batch proposal for every later turn. Only the application decides the run is over, so the
 * observed provider call count is the number of turns the application asked for.
 */
function installGreedyProvider(): void {
    const commandNames = [...new Set(PROVIDER_PLAN.map((call) => call.name))];
    let answeredDiscovery = false;
    runtimeMocks.generateWebLlmCompletion.mockImplementation(() => {
        if (!answeredDiscovery) {
            answeredDiscovery = true;
            return Promise.resolve(
                JSON.stringify([
                    { name: 'agent.catalog.discover', arguments: { category: 'command', names: commandNames } },
                ])
            );
        }
        return Promise.resolve(
            JSON.stringify([
                {
                    name: 'command.batch.propose',
                    arguments: {
                        commands: PROVIDER_PLAN.map((call) => ({ name: call.name, arguments: { ...call.arguments } })),
                        plan: {
                            semantic: { classification: 'simple', uncertainty: [] },
                            objective: 'Apply the exact requested mix changes while preserving the Drum Bus.',
                            constraints: ['Leave the Drum Bus unchanged.'],
                            scope: {
                                targetIds: [
                                    'track-lead-vocal',
                                    'track-guitar-left',
                                    'track-guitar-right',
                                    'track-room-mic',
                                ],
                                targetRanges: [],
                                protectedTargetIds: ['track-drum-bus'],
                                protectedRanges: [],
                            },
                            capabilityIds: commandNames,
                            assetIds: [],
                            alternatives: [],
                            validationStrategy: ['Validate exact track identities, values, and protected state.'],
                            stoppingConditions: ['Stop after one previewable proposal.'],
                        },
                    },
                },
            ])
        );
    });
}

function getConfirmations() {
    return pendingActionConfirmationStore.value?.confirmations ?? [];
}

function getRunIds(): string[] {
    return readAgentRunState().runs.map((run) => run.runId);
}

async function sendChatMessage(prompt: string): Promise<void> {
    flushAutomergeStorageWrites();
    await sendChatMessageWithoutDocumentFlush(prompt);
}

describe('vibe mixing control loop (AC-045)', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        installGreedyProvider();
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('vibe mixing control loop test');
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
        agentRunLifecycle.clear();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [
                createTrack('track-lead-vocal', 'Lead Vocal'),
                createTrack('track-guitar-left', 'Guitar Left'),
                createTrack('track-guitar-right', 'Guitar Right'),
                createTrack('track-room-mic', 'Room Mic'),
                createTrack('track-drum-bus', 'Drum Bus'),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(async () => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        agentRunLifecycle.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('ends one explicit request after its terminal proposal even when the provider would keep proposing', async () => {
        await sendChatMessage(PROMPT);

        // The greedy provider would answer forever; the application asked twice — discovery, then
        // the terminal proposal — and stopped.
        expect(runtimeMocks.generateWebLlmCompletion).toHaveBeenCalledTimes(2);
        expect(getConfirmations()).toHaveLength(1);
        expect(getRunIds()).toHaveLength(1);
    });

    it('re-prompts no provider turn and opens no further run after the proposal is confirmed and applied', async () => {
        await sendChatMessage(PROMPT);

        const confirmation = getConfirmations()[0];
        if (!confirmation) {
            throw new Error('Expected one pending confirmation from the single explicit request.');
        }
        const providerCallsBeforeApply = runtimeMocks.generateWebLlmCompletion.mock.calls.length;
        const runIdsBeforeApply = getRunIds();

        await expect(confirmPendingChatActions({ confirmationId: confirmation.id })).resolves.toEqual({
            status: 'executed',
        });

        expect(trackStore.value?.tracks.find((track) => track.id === 'track-lead-vocal')?.gain).toBe(0.7);
        expect(trackStore.value?.tracks.find((track) => track.id === 'track-room-mic')?.muted).toBe(true);
        expect(runtimeMocks.generateWebLlmCompletion.mock.calls).toHaveLength(providerCallsBeforeApply);
        expect(getRunIds()).toEqual(runIdsBeforeApply);
        expect(getConfirmations().filter((entry) => entry.id !== confirmation.id)).toEqual([]);
    });
});
