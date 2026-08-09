import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage } from '../sendChatMessage';

const PROMPT = 'Create a Drum Bus and route Kick, Snare, and Hats into it, leaving Parallel Compression unchanged.';

const providerPlan = [
    { name: 'createBus', arguments: { name: 'Drum Bus', binding: 'drum-bus' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-kick', outputId: '$drum-bus' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-snare', outputId: '$drum-bus' } },
    { name: 'setTrackOutput', arguments: { trackId: 'track-hats', outputId: '$drum-bus' } },
] as const;

const runtimeMocks = vi.hoisted(() => ({
    generateToolPlanningOutcome: vi.fn(),
    getAllSidechainRoutes: vi.fn(() => []),
    resolveToasterPadBinding: vi.fn(() => null),
    setTrackOutput: vi.fn(),
}));

vi.mock('../llmOrchestration/inference', () => ({
    generateToolPlanningOutcome: runtimeMocks.generateToolPlanningOutcome,
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => 'webllm',
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    setTrackOutput: runtimeMocks.setTrackOutput,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: runtimeMocks.getAllSidechainRoutes,
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

function getTrack(id: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === id);
    if (!track) {
        throw new Error(`Expected track ${id}`);
    }
    return track;
}

describe('drum bus prompt workflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtimeMocks.generateToolPlanningOutcome.mockResolvedValue({
            status: 'complete',
            toolCalls: providerPlan.map((call) => ({ name: call.name, arguments: { ...call.arguments } })),
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('drum bus prompt workflow test');
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
        const tracks = [
            createTrack('track-kick', 'Kick'),
            createTrack('track-snare', 'Snare'),
            createTrack('track-hats', 'Hats'),
            createTrack('track-parallel', 'Parallel Compression'),
            createTrack('track-room', 'Drum Room'),
        ];
        trackStore.set({ tracks, selectedTrackId: null, ghostClips: [] });
        chatStore.set({
            messages: [],
            isGenerating: false,
            enableReasoning: true,
            chatMode: 'prompt',
        });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('grounds, confirms, commits, receipts, undoes, and redoes the exact protected routing request', async () => {
        const unchangedBefore = structuredClone([getTrack('track-parallel'), getTrack('track-room')]);

        await sendChatMessage(PROMPT);

        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        expect(confirmation?.actions).toHaveLength(4);
        const busAction = confirmation?.actions[0];
        if (busAction?.type !== 'createBus' || !busAction.payload.busId) {
            throw new Error('Expected one app-owned Drum Bus identity');
        }
        const busId = busAction.payload.busId;
        expect(busId).toMatch(/^bus-ai-/u);
        expect(confirmation?.actions).toEqual([
            { type: 'createBus', payload: { name: 'Drum Bus', busId } },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-kick', outputId: busId, expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-snare', outputId: busId, expectedOutputId: 'master' },
            },
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-hats', outputId: busId, expectedOutputId: 'master' },
            },
        ]);
        expect(confirmation).toMatchObject({
            risk: { level: 'authority-sensitive' },
            protectedUnchanged: [{ id: 'track-parallel', name: 'Parallel Compression' }],
        });
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain(`Create bus "Drum Bus" (${busId})`);
        expect(proposal?.content).toContain(`Route "Kick" (track-kick) from master to "Drum Bus" (${busId})`);
        expect(proposal?.content).toContain('Risk: authority-sensitive');
        expect(proposal?.content).toContain('Protected unchanged: "Parallel Compression" (track-parallel)');

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(getTrack('track-kick').outputId).toBe(busId);
        expect(getTrack('track-snare').outputId).toBe(busId);
        expect(getTrack('track-hats').outputId).toBe(busId);
        expect([getTrack('track-parallel'), getTrack('track-room')]).toEqual(unchangedBefore);
        expect(getPendingActionConfirmation(confirmation?.id ?? '')?.executedActions).toEqual([
            expect.objectContaining({ actionType: 'createBus', affectedIds: [busId], outcome: 'committed' }),
            expect.objectContaining({
                actionType: 'setTrackOutput',
                affectedIds: [busId, 'track-kick'],
                outcome: 'committed',
            }),
            expect.objectContaining({
                actionType: 'setTrackOutput',
                affectedIds: [busId, 'track-snare'],
                outcome: 'committed',
            }),
            expect.objectContaining({
                actionType: 'setTrackOutput',
                affectedIds: [busId, 'track-hats'],
                outcome: 'committed',
            }),
        ]);
        expect(undoStore.value?.past).toHaveLength(4);

        await undo();

        expect(trackStore.value?.tracks.some((track) => track.id === busId)).toBe(false);
        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            'master',
            'master',
            'master',
        ]);
        expect([getTrack('track-parallel'), getTrack('track-room')]).toEqual(unchangedBefore);

        await redo();

        expect(trackStore.value?.tracks.filter((track) => track.id === busId)).toHaveLength(1);
        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            busId,
            busId,
            busId,
        ]);
        expect([getTrack('track-parallel'), getTrack('track-room')]).toEqual(unchangedBefore);
    });

    it('rejects provider enlargement that would route the protected Parallel Compression track', async () => {
        runtimeMocks.generateToolPlanningOutcome.mockResolvedValue({
            status: 'complete',
            toolCalls: [
                ...providerPlan.map((call) => ({ name: call.name, arguments: { ...call.arguments } })),
                {
                    name: 'setTrackOutput',
                    arguments: { trackId: 'track-parallel', outputId: '$drum-bus' },
                },
            ],
        });
        const before = structuredClone(trackStore.value?.tracks);

        await sendChatMessage(PROMPT);

        expect(chatStore.value?.messages.every((message) => !message.pendingActionConfirmationId)).toBe(true);
        expect(trackStore.value?.tracks).toEqual(before);
        expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('aborts the whole batch before runtime, receipt, or undo publication when a later route conflicts', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getPendingActionConfirmation(
            chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)
                ?.pendingActionConfirmationId ?? ''
        );
        const busAction = confirmation?.actions[0];
        if (!confirmation || busAction?.type !== 'createBus' || !busAction.payload.busId) {
            throw new Error('Expected the proposed Drum Bus batch');
        }
        const conflictingActions = confirmation.actions.map((action) => {
            if (action.type !== 'setTrackOutput' || action.payload.trackId !== 'track-hats') {
                return action;
            }
            return { ...action, payload: { ...action.payload, expectedOutputId: 'other-output' } };
        });
        confirmation.actions.splice(0, confirmation.actions.length, ...conflictingActions);

        const result = await confirmPendingChatActions({ confirmationId: confirmation.id });

        expect(result.status).toBe('failed');
        expect(trackStore.value?.tracks.some((track) => track.id === busAction.payload.busId)).toBe(false);
        expect(['track-kick', 'track-snare', 'track-hats'].map((id) => getTrack(id).outputId)).toEqual([
            'master',
            'master',
            'master',
        ]);
        expect(runtimeMocks.setTrackOutput).not.toHaveBeenCalled();
        expect(getPendingActionConfirmation(confirmation.id)?.executedActions).toEqual([]);
        expect(undoStore.value?.past).toEqual([]);
    });
});
