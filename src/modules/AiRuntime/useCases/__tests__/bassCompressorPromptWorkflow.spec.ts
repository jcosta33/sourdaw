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
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { generateWebLlmCompletion } from '../../repositories/webLlm/generateWebLlmCompletion';
import { clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';
import {
    createHostedSemanticListPlanningResponder,
    createProviderSemanticListPlanningResponder,
} from './providerToolPlanningFixture';

const PROMPT = 'Insert a compressor after EQ on every bass track, excluding frozen tracks.';
const BASS_DI_DEVICE_IDS = ['device-bass-di-eq', 'device-bass-di-saturator'];
const BASS_AMP_DEVICE_IDS = ['device-bass-amp-preamp', 'device-bass-amp-eq', 'device-bass-amp-chorus'];
const BASS_DI_INSERTED_DEVICE_IDS = [
    'device-bass-di-eq',
    'device-ai-track-bass-di-builtin-compressor',
    'device-bass-di-saturator',
];
const BASS_AMP_INSERTED_DEVICE_IDS = [
    'device-bass-amp-preamp',
    'device-bass-amp-eq',
    'device-ai-track-bass-amp-builtin-compressor',
    'device-bass-amp-chorus',
];

const providerPlan = [
    {
        name: 'addDevice',
        arguments: { trackId: 'track-bass-di', deviceType: 'Compressor', afterDeviceId: 'device-bass-di-eq' },
    },
    {
        name: 'addDevice',
        arguments: { trackId: 'track-bass-amp', deviceType: 'Compressor', afterDeviceId: 'device-bass-amp-eq' },
    },
] as const;

const providerScope = {
    targetIds: ['track-bass-di', 'device-bass-di-eq', 'track-bass-amp', 'device-bass-amp-eq'],
    targetRanges: [],
    protectedTargetIds: ['track-bass-frozen'],
    protectedRanges: [],
};

const providerList = [
    {
        id: 'add-bass-di-compressor',
        name: 'addDevice',
        arguments: { deviceType: 'Compressor', afterDeviceId: 'device-bass-di-eq' },
        selector: {
            targetArgument: 'trackId',
            entity: 'track',
            where: { name: 'Bass DI' },
            quantity: { unit: 'targets', exactly: 1 },
        },
    },
    {
        id: 'add-bass-amp-compressor',
        name: 'addDevice',
        arguments: { deviceType: 'Compressor', afterDeviceId: 'device-bass-amp-eq' },
        selector: {
            targetArgument: 'trackId',
            entity: 'track',
            where: { name: 'Bass Amp' },
            quantity: { unit: 'targets', exactly: 1 },
        },
    },
];

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        applyRuntimeGraphDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        resolveToasterPadBinding: vi.fn(() => null),
        updateDeviceParam: vi.fn(),
    };
});

vi.mock('../llmOrchestration/backendResolution/getBackendChain', () => ({
    getBackendChain: () => [runtimeMocks.backend.value],
}));

vi.mock('../llmOrchestration/backendResolution/helpers', () => ({
    resolveBackend: () => runtimeMocks.backend.value,
}));

vi.mock('../../repositories/webLlm/generateWebLlmCompletion', () => ({
    generateWebLlmCompletion: runtimeMocks.generateWebLlmCompletion,
}));

vi.mock('../../repositories/webLlm/isWebLlmLoaded', () => ({
    isWebLlmLoaded: () => true,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    applyRuntimeGraphDelta: runtimeMocks.applyRuntimeGraphDelta,
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function createDevice(id: string, name: string, type: string): Track['devices'][number] {
    return { id, name, type, bypassed: false, parameterValues: {} };
}

function createTrack({ id, name, frozen = false }: { id: string; name: string; frozen?: boolean }): Track {
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
        devices: [createDevice(`device-${id.replace('track-', '')}-eq`, 'EQ', 'builtin-eq')],
        sends: [],
        midiFx: [],
        frozen,
        freezeState: frozen ? { status: 'frozen' } : { status: 'unfrozen' },
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

function getTrack(trackId: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        throw new Error(`Expected track ${trackId}`);
    }
    return track;
}

function getConfirmation() {
    return getPendingActionConfirmation(
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
            ''
    );
}

function getHostedRequestBody(): string {
    const body = runtimeMocks.fetch.mock.calls.at(-1)?.[1]?.body;
    if (typeof body !== 'string') {
        throw new TypeError('Expected one hosted provider request body');
    }
    return body;
}

function getHostedUserMessage(init: RequestInit | undefined): string {
    if (typeof init?.body !== 'string') {
        throw new TypeError('Expected hosted provider request body');
    }
    const request = JSON.parse(init.body) as { messages?: Array<{ role?: string; content?: string }> };
    const userMessage = request.messages?.at(-1);
    if (userMessage?.role !== 'user' || typeof userMessage.content !== 'string') {
        throw new TypeError('Expected hosted provider user message');
    }
    return userMessage.content;
}

describe('bass compressor prompt workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.applyRuntimeGraphDelta.mockReset();
        runtimeMocks.applyRuntimeGraphDelta.mockReturnValue({
            acceptance: 'accepted',
            application: 'applied',
        });
        runtimeMocks.backend.value = 'webllm';
        const webLlmResponder = createProviderSemanticListPlanningResponder(providerList, providerScope);
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) =>
            Promise.resolve(webLlmResponder(userMessage))
        );
        const hostedResponder = createHostedSemanticListPlanningResponder(providerList, providerScope);
        runtimeMocks.fetch.mockImplementation(async (_input, init) => hostedResponder(getHostedUserMessage(init)));
        vi.stubGlobal('fetch', runtimeMocks.fetch);
        await cloudSession.clear();
        await cloudSession.replace_runtime({
            provider: 'openai-compatible',
            session_id: null,
            model: 'fixture-model',
            base_url: 'http://localhost:1234/v1',
        });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('bass compressor prompt workflow test');
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
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const bassDi = createTrack({ id: 'track-bass-di', name: 'Bass DI' });
        bassDi.devices.push({
            ...createDevice('device-bass-di-saturator', 'Saturator', 'builtin-saturator'),
            bypassed: true,
            parameterValues: { drive: 0.42 },
        });
        const bassAmp = createTrack({ id: 'track-bass-amp', name: 'Bass Amp' });
        bassAmp.devices.unshift(createDevice('device-bass-amp-preamp', 'Preamp', 'builtin-preamp'));
        bassAmp.devices.push(createDevice('device-bass-amp-chorus', 'Chorus', 'builtin-chorus'));
        trackStore.set({
            tracks: [
                bassDi,
                bassAmp,
                createTrack({ id: 'track-bass-frozen', name: 'Bass Frozen', frozen: true }),
                createTrack({ id: 'track-guitar', name: 'Guitar' }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(async () => {
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('grounds, confirms, commits, receipts, undoes, and redoes the exact non-frozen bass insertions', async () => {
        const frozenBefore = structuredClone(getTrack('track-bass-frozen'));
        const guitarBefore = structuredClone(getTrack('track-guitar'));
        const bassDiDevicesBefore = structuredClone(getTrack('track-bass-di').devices);
        const bassAmpDevicesBefore = structuredClone(getTrack('track-bass-amp').devices);
        await sendChatMessage(PROMPT);

        const providerRequest = vi.mocked(generateWebLlmCompletion).mock.calls[0]?.[1];
        expect(providerRequest).toContain(PROMPT);
        expect(providerRequest).toContain('"frozen":true');

        const confirmation = getConfirmation();
        expect(confirmation?.actions).toEqual([
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-bass-di',
                    deviceType: 'builtin-compressor',
                    afterDeviceId: 'device-bass-di-eq',
                    expectedDeviceIds: BASS_DI_DEVICE_IDS,
                    expectedFrozen: false,
                    deviceId: 'device-ai-track-bass-di-builtin-compressor',
                },
            },
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-bass-amp',
                    deviceType: 'builtin-compressor',
                    afterDeviceId: 'device-bass-amp-eq',
                    expectedDeviceIds: BASS_AMP_DEVICE_IDS,
                    expectedFrozen: false,
                    deviceId: 'device-ai-track-bass-amp-builtin-compressor',
                },
            },
        ]);
        expect(confirmation?.risk).toMatchObject({ level: 'broad-reversible' });
        expect(confirmation?.protectedUnchanged).toEqual([{ id: 'track-bass-frozen', name: 'Bass Frozen' }]);
        expect(confirmation?.affectedIds).toEqual([
            'device-ai-track-bass-di-builtin-compressor',
            'track-bass-di',
            'device-bass-di-eq',
            'device-ai-track-bass-amp-builtin-compressor',
            'track-bass-amp',
            'device-bass-amp-eq',
        ]);
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain(
            'Insert "Compressor" (device-ai-track-bass-di-builtin-compressor, builtin-compressor) on "Bass DI" (track-bass-di) after "EQ" (device-bass-di-eq)'
        );
        expect(proposal?.content).toContain('Protected unchanged: "Bass Frozen" (track-bass-frozen)');
        expect(undoStore.value?.past).toEqual([]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_INSERTED_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_INSERTED_DEVICE_IDS);
        expect(
            getTrack('track-bass-di').devices.filter(
                (device) => device.id !== 'device-ai-track-bass-di-builtin-compressor'
            )
        ).toEqual(bassDiDevicesBefore);
        expect(
            getTrack('track-bass-amp').devices.filter(
                (device) => device.id !== 'device-ai-track-bass-amp-builtin-compressor'
            )
        ).toEqual(bassAmpDevicesBefore);
        expect(getTrack('track-bass-frozen')).toEqual(frozenBefore);
        expect(getTrack('track-guitar')).toEqual(guitarBefore);
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                command: 'replace-track-device-chain',
                operation: 'add-device',
                after: expect.objectContaining({
                    id: 'track-bass-di',
                    devices: expect.arrayContaining([
                        expect.objectContaining({ id: 'device-ai-track-bass-di-builtin-compressor' }),
                    ]),
                }),
            })
        );
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                command: 'replace-track-device-chain',
                operation: 'add-device',
                after: expect.objectContaining({
                    id: 'track-bass-amp',
                    devices: expect.arrayContaining([
                        expect.objectContaining({ id: 'device-ai-track-bass-amp-builtin-compressor' }),
                    ]),
                }),
            })
        );
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain(
            'Affected IDs: device-ai-track-bass-di-builtin-compressor, track-bass-di, device-bass-di-eq'
        );
        expect(receipt?.content).toContain(
            'Affected IDs: device-ai-track-bass-amp-builtin-compressor, track-bass-amp, device-bass-amp-eq'
        );
        expect(receipt?.content).toContain('Protected unchanged: "Bass Frozen" (track-bass-frozen)');
        expect(undoStore.value?.past).toHaveLength(2);

        await undo();

        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_DEVICE_IDS);
        expect(getTrack('track-bass-frozen')).toEqual(frozenBefore);

        await redo();

        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_INSERTED_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_INSERTED_DEVICE_IDS);
        expect(getTrack('track-bass-frozen')).toEqual(frozenBefore);
    });

    it('normalizes the hosted provider to the same guarded insertion plan and receipt', async () => {
        runtimeMocks.backend.value = 'cloud';

        await sendChatMessage(PROMPT);

        expect(getHostedRequestBody()).toContain('\\"frozen\\":true');
        const confirmation = getConfirmation();
        expect(confirmation?.actions).toEqual([
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-bass-di',
                    deviceType: 'builtin-compressor',
                    afterDeviceId: 'device-bass-di-eq',
                    expectedDeviceIds: BASS_DI_DEVICE_IDS,
                    expectedFrozen: false,
                    deviceId: 'device-ai-track-bass-di-builtin-compressor',
                },
            },
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-bass-amp',
                    deviceType: 'builtin-compressor',
                    afterDeviceId: 'device-bass-amp-eq',
                    expectedDeviceIds: BASS_AMP_DEVICE_IDS,
                    expectedFrozen: false,
                    deviceId: 'device-ai-track-bass-amp-builtin-compressor',
                },
            },
        ]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain(
            'Insert "Compressor" (device-ai-track-bass-amp-builtin-compressor, builtin-compressor) on "Bass Amp" (track-bass-amp) after "EQ" (device-bass-amp-eq)'
        );
        expect(receipt?.content).toContain('Protected unchanged: "Bass Frozen" (track-bass-frozen)');
    });

    it('rejects provider enlargement to a frozen bass track without a proposal or write', async () => {
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(
            JSON.stringify([
                ...providerPlan,
                {
                    name: 'addDevice',
                    arguments: {
                        trackId: 'track-bass-frozen',
                        deviceType: 'Compressor',
                        afterDeviceId: 'device-bass-frozen-eq',
                    },
                },
            ])
        );
        const before = structuredClone(trackStore.value?.tracks);

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(trackStore.value?.tracks).toEqual(before);
        expect(runtimeMocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('keeps the exact compiler-resolved EQ anchor when the target has a repeated EQ', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-bass-di'
                    ? { ...track, devices: [...track.devices, createDevice('device-bass-di-eq-2', 'EQ', 'builtin-eq')] }
                    : track
            ),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmation()?.actions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'addDevice',
                    payload: expect.objectContaining({
                        trackId: 'track-bass-di',
                        afterDeviceId: 'device-bass-di-eq',
                        expectedDeviceIds: [...BASS_DI_DEVICE_IDS, 'device-bass-di-eq-2'],
                    }),
                }),
            ])
        );
        expect(runtimeMocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
    });

    it('rejects a target track with no matching EQ anchor', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'track-bass-di') {
                    return track;
                }
                return { ...track, devices: [] };
            }),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(runtimeMocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
    });

    it('rejects an undiscoverable provider anchor even though selector scope remains exact', async () => {
        const responder = createProviderSemanticListPlanningResponder(
            providerList.map((item) =>
                item.id === 'add-bass-di-compressor'
                    ? { ...item, arguments: { ...item.arguments, afterDeviceId: 'device-bass-di-missing' } }
                    : item
            ),
            providerScope
        );
        runtimeMocks.generateWebLlmCompletion.mockImplementation((_systemPrompt, userMessage) =>
            Promise.resolve(responder(userMessage))
        );

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(runtimeMocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
    });

    it('grounds a renamed device from its canonical EQ descriptor', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'track-bass-di') {
                    return track;
                }
                return {
                    ...track,
                    devices: track.devices.map((device) =>
                        device.id === 'device-bass-di-eq' ? { ...device, name: 'Low Cut' } : device
                    ),
                };
            }),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmation()?.actions[0]).toMatchObject({
            type: 'addDevice',
            payload: { afterDeviceId: 'device-bass-di-eq' },
        });
    });

    it('rejects a non-EQ device whose display name is EQ', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'track-bass-di') {
                    return track;
                }
                return {
                    ...track,
                    devices: track.devices.map((device) => {
                        if (device.id === 'device-bass-di-eq') {
                            return { ...device, name: 'Low Cut' };
                        }
                        if (device.id === 'device-bass-di-saturator') {
                            return { ...device, name: 'EQ' };
                        }
                        return device;
                    }),
                };
            }),
        });
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(
            JSON.stringify([
                {
                    name: 'addDevice',
                    arguments: {
                        trackId: 'track-bass-di',
                        deviceType: 'Compressor',
                        afterDeviceId: 'device-bass-di-saturator',
                    },
                },
                providerPlan[1],
            ])
        );

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(runtimeMocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
    });

    it('protects only frozen tracks in the semantic bass target set', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id !== 'track-guitar') {
                    return track;
                }
                return { ...track, frozen: true, freezeState: { status: 'frozen' } };
            }),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmation()?.protectedUnchanged).toEqual([{ id: 'track-bass-frozen', name: 'Bass Frozen' }]);
    });

    it('fails before any runtime write when a collaborator changes a later target chain', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-bass-amp'
                    ? {
                          ...track,
                          devices: [...track.devices, createDevice('device-remote-change', 'Gain', 'builtin-gain')],
                      }
                    : track
            ),
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('failed');
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual([
            ...BASS_AMP_DEVICE_IDS,
            'device-remote-change',
        ]);
        expect(runtimeMocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('reports a rejected later runtime delta without replaying the committed batch', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeMocks.applyRuntimeGraphDelta
            .mockReturnValueOnce({ acceptance: 'accepted', application: 'applied' })
            .mockReturnValueOnce({
                acceptance: 'rejected',
                application: 'not-applied',
                reason: 'runtime graph refused compressor',
            });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('executed');
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_INSERTED_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_INSERTED_DEVICE_IDS);
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenCalledTimes(2);
        expect(undoStore.value?.past).toHaveLength(2);
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.error).toContain('runtime graph refused compressor');
        expect(receipt?.content.toLowerCase()).toContain('do not retry these confirmed actions');
    });

    it('fails the whole confirmation when a collaborator changes both target chains', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) => {
                if (track.id === 'track-bass-di') {
                    return {
                        ...track,
                        devices: [...track.devices, createDevice('device-remote-di', 'Gain', 'builtin-gain')],
                    };
                }
                if (track.id === 'track-bass-amp') {
                    return {
                        ...track,
                        devices: [...track.devices, createDevice('device-remote-amp', 'Gain', 'builtin-gain')],
                    };
                }
                return track;
            }),
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('failed');
        expect(runtimeMocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual([
            ...BASS_DI_DEVICE_IDS,
            'device-remote-di',
        ]);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual([
            ...BASS_AMP_DEVICE_IDS,
            'device-remote-amp',
        ]);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('reports manual repair when the runtime cannot reconcile a committed device delta', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeMocks.applyRuntimeGraphDelta.mockReturnValue({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'failed',
            reason: 'runtime graph removal failed; manual repair is required',
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toMatchObject({ status: 'executed' });
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.error).toContain('runtime graph removal failed');
        expect(receipt?.content.toLowerCase()).toContain('manual repair');
        expect(undoStore.value?.past).toHaveLength(2);
    });

    it('keeps a partial graph-reconciliation failure observable after the project commits', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeMocks.applyRuntimeGraphDelta
            .mockReturnValueOnce({
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'failed',
                reason: 'partial TrackNode removal failed; manual repair is required',
            })
            .mockReturnValueOnce({ acceptance: 'accepted', application: 'applied' });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toMatchObject({ status: 'executed' });
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.error).toContain('partial TrackNode removal failed');
        expect(receipt?.content.toLowerCase()).toContain('manual repair');
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenCalledTimes(2);
        expect(undoStore.value?.past).toHaveLength(2);
    });

    it('keeps grouped redo retryable when a collaborator freezes an eligible bass track after undo', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        await undo();
        runtimeMocks.applyRuntimeGraphDelta.mockClear();
        const futureBefore = structuredClone(undoStore.value?.future);
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected undone track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-bass-di'
                    ? { ...track, frozen: true, freezeState: { status: 'frozen' as const } }
                    : track
            ),
        });

        await redo();

        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_DEVICE_IDS);
        expect(runtimeMocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        expect(undoStore.value?.future).toEqual(futureBefore);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('reports persistent post-commit runtime teardown failures as manual repair after grouped undo', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        runtimeMocks.applyRuntimeGraphDelta.mockClear();
        runtimeMocks.applyRuntimeGraphDelta.mockReturnValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'persistent runtime teardown failure',
        });

        let undoError: unknown;
        try {
            await undo();
        } catch (error) {
            undoError = error;
        }

        expect(undoError).toBeInstanceOf(Error);
        if (!(undoError instanceof Error)) {
            throw new Error('Expected grouped undo to report committed runtime divergence');
        }
        expect(undoError.name).toBe('AppActionCommittedError');
        expect(undoError.cause).toBeInstanceOf(Error);
        if (!(undoError.cause instanceof Error)) {
            throw new Error('Expected committed error to retain the runtime warning');
        }
        expect(undoError.cause.message).toContain('persistent runtime teardown failure');
        expect(undoError.cause.message.toLowerCase()).toContain('manual repair');
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_DEVICE_IDS);
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenCalledTimes(4);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);
    });

    it('refuses grouped undo after a collaborator changes one inserted chain', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected committed track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-bass-di'
                    ? {
                          ...track,
                          devices: [...track.devices, createDevice('device-collaborator-gain', 'Gain', 'builtin-gain')],
                      }
                    : track
            ),
        });
        const beforeUndo = structuredClone(trackStore.value?.tracks);
        const historyBeforeUndo = structuredClone(undoStore.value);
        runtimeMocks.applyRuntimeGraphDelta.mockClear();

        await undo();

        expect(trackStore.value?.tracks).toEqual(beforeUndo);
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual([
            ...BASS_DI_INSERTED_DEVICE_IDS,
            'device-collaborator-gain',
        ]);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_INSERTED_DEVICE_IDS);
        expect(runtimeMocks.applyRuntimeGraphDelta).not.toHaveBeenCalled();
        expect(undoStore.value).toEqual(historyBeforeUndo);
        runtimeMocks.applyRuntimeGraphDelta.mockClear();

        const retryState = trackStore.value;
        if (!retryState) {
            throw new Error('Expected retryable track state');
        }
        trackStore.set({
            ...retryState,
            tracks: retryState.tracks.map((track) =>
                track.id === 'track-bass-di'
                    ? { ...track, devices: track.devices.filter((device) => device.id !== 'device-collaborator-gain') }
                    : track
            ),
        });

        await undo();

        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_DEVICE_IDS);
        expect(runtimeMocks.applyRuntimeGraphDelta).toHaveBeenCalledTimes(2);
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);
    });
});
