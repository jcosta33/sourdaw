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

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    return {
        addDeviceToStrip: vi.fn(),
        backend,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        removeDeviceFromStrip: vi.fn(),
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
    addDeviceToStrip: runtimeMocks.addDeviceToStrip,
    removeDeviceFromStrip: runtimeMocks.removeDeviceFromStrip,
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
    const body = runtimeMocks.fetch.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') {
        throw new TypeError('Expected one hosted provider request body');
    }
    return body;
}

describe('bass compressor prompt workflow', () => {
    beforeEach(async () => {
        configureAiWorkflowCommandPreflightFixture();
        vi.clearAllMocks();
        runtimeMocks.removeDeviceFromStrip.mockReset();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(JSON.stringify(providerPlan));
        runtimeMocks.fetch.mockResolvedValue(
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            finish_reason: 'tool_calls',
                            message: {
                                tool_calls: providerPlan.map((call) => ({
                                    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
                                })),
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
        );
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
        expect(providerRequest).toContain('device-bass-di-eq');
        expect(providerRequest).toContain('device-bass-amp-eq');
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
            'track-bass-di',
            'device-bass-di-eq',
            'device-ai-track-bass-di-builtin-compressor',
            'track-bass-amp',
            'device-bass-amp-eq',
            'device-ai-track-bass-amp-builtin-compressor',
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
        expect(runtimeMocks.addDeviceToStrip).toHaveBeenNthCalledWith(
            1,
            'track-bass-di',
            'device-ai-track-bass-di-builtin-compressor',
            'builtin-compressor',
            undefined,
            ['device-bass-di-eq']
        );
        expect(runtimeMocks.addDeviceToStrip).toHaveBeenNthCalledWith(
            2,
            'track-bass-amp',
            'device-ai-track-bass-amp-builtin-compressor',
            'builtin-compressor',
            undefined,
            ['device-bass-amp-preamp', 'device-bass-amp-eq']
        );
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain(
            'Affected IDs: track-bass-di, device-bass-di-eq, device-ai-track-bass-di-builtin-compressor'
        );
        expect(receipt?.content).toContain(
            'Affected IDs: track-bass-amp, device-bass-amp-eq, device-ai-track-bass-amp-builtin-compressor'
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
        expect(runtimeMocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects an ambiguous repeated EQ anchor on a target track', async () => {
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

        expect(getConfirmation()).toBeNull();
        expect(runtimeMocks.addDeviceToStrip).not.toHaveBeenCalled();
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
        expect(runtimeMocks.addDeviceToStrip).not.toHaveBeenCalled();
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
        expect(runtimeMocks.addDeviceToStrip).not.toHaveBeenCalled();
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

    it('compensates the first runtime insertion when the later target chain conflicts', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeMocks.addDeviceToStrip.mockImplementationOnce(() => {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected track state during runtime insertion');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => {
                    if (track.id !== 'track-bass-amp') {
                        return track;
                    }
                    return {
                        ...track,
                        devices: [...track.devices, createDevice('device-remote-change', 'Gain', 'builtin-gain')],
                    };
                }),
            });
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('failed');
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_DEVICE_IDS);
        expect(runtimeMocks.removeDeviceFromStrip).toHaveBeenCalledWith(
            'track-bass-di',
            'device-ai-track-bass-di-builtin-compressor'
        );
        expect(undoStore.value?.past).toEqual([]);
    });

    it('atomically compensates runtime topology when a later insertion fails', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeMocks.addDeviceToStrip
            .mockImplementationOnce(() => undefined)
            .mockImplementationOnce(() => {
                throw new Error('runtime graph refused compressor');
            });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('failed');
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_DEVICE_IDS);
        expect(runtimeMocks.removeDeviceFromStrip).toHaveBeenCalledWith(
            'track-bass-di',
            'device-ai-track-bass-di-builtin-compressor'
        );
        expect(undoStore.value?.past).toEqual([]);
    });

    it('uses device-scoped abort cleanup when the inserted chain changes before a later conflict', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeMocks.addDeviceToStrip.mockImplementationOnce(() => {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected track state during runtime insertion');
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
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result.status).toBe('failed');
        expect(runtimeMocks.removeDeviceFromStrip).toHaveBeenCalledWith(
            'track-bass-di',
            'device-ai-track-bass-di-builtin-compressor'
        );
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual(BASS_DI_DEVICE_IDS);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_DEVICE_IDS);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('reports a manual-repair failure when device-scoped abort cleanup cannot remove the runtime node', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeMocks.addDeviceToStrip.mockImplementationOnce(() => {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected track state during runtime insertion');
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
        });
        runtimeMocks.removeDeviceFromStrip.mockImplementation(() => {
            throw new Error('runtime graph removal failed');
        });

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toMatchObject({ status: 'failed' });
        if (result.status !== 'failed') {
            throw new Error('Expected failed cleanup result');
        }
        expect(result.reason).toContain('runtime graph removal failed');
        expect(result.reason.toLowerCase()).toContain('manual repair');
        expect(undoStore.value?.past).toEqual([]);
    });

    it('uses one strict runtime cleanup owner so a partial graph-removal failure stays observable', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        runtimeMocks.addDeviceToStrip.mockImplementationOnce(() => {
            const state = trackStore.value;
            if (!state) {
                throw new Error('Expected track state during runtime insertion');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => {
                    if (track.id !== 'track-bass-amp') {
                        return track;
                    }
                    return {
                        ...track,
                        devices: [...track.devices, createDevice('device-remote-amp', 'Gain', 'builtin-gain')],
                    };
                }),
            });
        });
        runtimeMocks.removeDeviceFromStrip
            .mockImplementationOnce(() => {
                throw new Error('partial TrackNode removal failed');
            })
            .mockImplementationOnce(() => undefined);

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toMatchObject({ status: 'failed' });
        if (result.status !== 'failed') {
            throw new Error('Expected failed cleanup result');
        }
        expect(result.reason).toContain('partial TrackNode removal failed');
        expect(result.reason.toLowerCase()).toContain('manual repair');
        expect(runtimeMocks.removeDeviceFromStrip).toHaveBeenCalledTimes(1);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('keeps grouped redo retryable when a collaborator freezes an eligible bass track after undo', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        await undo();
        runtimeMocks.addDeviceToStrip.mockClear();
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
        expect(runtimeMocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(undoStore.value?.future).toEqual(futureBefore);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('reports persistent post-commit runtime teardown failures as manual repair after grouped undo', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });
        runtimeMocks.removeDeviceFromStrip.mockImplementation(() => {
            throw new Error('persistent runtime teardown failure');
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
        expect(runtimeMocks.removeDeviceFromStrip).toHaveBeenCalledTimes(4);
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
        runtimeMocks.removeDeviceFromStrip.mockClear();
        runtimeMocks.addDeviceToStrip.mockClear();

        await undo();

        expect(trackStore.value?.tracks).toEqual(beforeUndo);
        expect(getTrack('track-bass-di').devices.map((device) => device.id)).toEqual([
            ...BASS_DI_INSERTED_DEVICE_IDS,
            'device-collaborator-gain',
        ]);
        expect(getTrack('track-bass-amp').devices.map((device) => device.id)).toEqual(BASS_AMP_INSERTED_DEVICE_IDS);
        expect(runtimeMocks.removeDeviceFromStrip).not.toHaveBeenCalled();
        expect(runtimeMocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(undoStore.value).toEqual(historyBeforeUndo);
        runtimeMocks.removeDeviceFromStrip.mockClear();
        runtimeMocks.addDeviceToStrip.mockClear();

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
        expect(runtimeMocks.removeDeviceFromStrip).toHaveBeenCalledTimes(2);
        expect(runtimeMocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
        expect(undoStore.value?.future).toHaveLength(2);
    });
});
