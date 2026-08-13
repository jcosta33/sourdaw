import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
    proposePendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../confirmPendingChatActions';

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
        { type: 'createBus', payload: { name: 'Vocal Plate', busId: BUS_ID } },
        { type: 'addDevice', payload: { trackId: BUS_ID, deviceType: 'builtin-reverb' } },
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

function propose(actions: ExecutableRuntimeAction[], id: string): void {
    proposePendingActionConfirmation({
        id,
        prompt: 'create a Vocal Plate bus, add Reverb, and route Vocals to it',
        assistantMessageId: 'assistant-1',
        actions,
        actionLabels: actions.map((action) => action.type),
        executionMode: 'atomic',
        projectRevision: captureProjectRevision(),
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
});
