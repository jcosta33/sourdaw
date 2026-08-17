import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus, setDeviceParameter } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    recordAutomationValue,
    releaseTouchAutomation,
    setAutomationRecordingDependencies,
    startAutomationRecording,
    stopAutomationRecording,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
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
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { cloudSession } from '../../repositories/cloudLlm/cloudSession';
import { generateWebLlmCompletion } from '../../repositories/webLlm/generateWebLlmCompletion';
import { aiActionHistoryStore, clearAiHistory } from '../../stores/aiActionHistoryStore';
import { chatStore } from '../../stores/chatStore';
import {
    clearPendingActionConfirmations,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { getDeviceParameterPromptScope } from '../agentReference/getDeviceParameterPromptScope';
import { confirmPendingChatActions } from '../confirmPendingChatActions';
import { getProjectContext } from '../getProjectContext';
import { sendChatMessage } from '../sendChatMessage';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const PROMPT =
    'Set the Bass DI compressor threshold to -18 dB and ratio to 4:1, leaving attack, release, and makeup gain unchanged.';
const CANCELLED_PROMPT = `${PROMPT} Actually, cancel that command.`;
const COMPRESSOR_ID = 'device-bass-di-compressor';
const DEVICE_IDS = ['device-bass-di-eq', COMPRESSOR_ID, 'device-bass-di-saturator'];
const INITIAL_PARAMETERS = {
    'comp-threshold': -24,
    'comp-ratio': 2,
    'comp-attack': 12,
    'comp-release': 180,
    'comp-knee': 6,
    'comp-makeup': 3,
};

const providerPlan = [
    {
        name: 'setDeviceParameter',
        arguments: { deviceId: COMPRESSOR_ID, paramId: 'comp-threshold', value: -18 },
    },
    {
        name: 'setDeviceParameter',
        arguments: { deviceId: COMPRESSOR_ID, paramId: 'comp-ratio', value: 4 },
    },
] as const;

const runtimeMocks = vi.hoisted(() => {
    const backend: { value: 'cloud' | 'webllm' } = { value: 'webllm' };
    const failedRuntimeWrites = new Set<string>();
    const runtimeParameterValues = new Map<string, number>();
    return {
        backend,
        failedRuntimeWrites,
        fetch: vi.fn<typeof fetch>(),
        generateWebLlmCompletion: vi.fn(),
        resolveToasterPadBinding: vi.fn(() => null),
        runtimeParameterValues,
        updateDeviceParam: vi.fn((_trackId: string, _deviceId: string, paramId: string, value: number) => {
            const writeKey = `${paramId}:${String(value)}`;
            if (failedRuntimeWrites.has(writeKey)) {
                throw new Error(`Persistent runtime write failure: ${writeKey}`);
            }
            runtimeParameterValues.set(paramId, value);
        }),
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
    resolveToasterPadBinding: runtimeMocks.resolveToasterPadBinding,
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function createDevice(
    id: string,
    name: string,
    type: string,
    parameterValues: Record<string, number> = {}
): Track['devices'][number] {
    return { id, name, type, bypassed: false, parameterValues };
}

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

function getTrack(trackId: string): Track {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!track) {
        throw new Error(`Expected track ${trackId}`);
    }
    return track;
}

function getCompressor(): Track['devices'][number] {
    const device = getTrack('track-bass-di').devices.find((candidate) => candidate.id === COMPRESSOR_ID);
    if (!device) {
        throw new Error(`Expected device ${COMPRESSOR_ID}`);
    }
    return device;
}

function simulateCollaboratorFreeze(frozen: boolean): void {
    const track = getTrack('track-bass-di');
    track.frozen = frozen;
    track.freezeState = frozen
        ? {
              status: 'frozen',
              freezeId: 'freeze-collaborator',
              frozenBufferId: 'buffer-collaborator',
              sourceContentHash: 'hash-collaborator',
          }
        : { status: 'unfrozen' };
}

function getConfirmation() {
    return getPendingActionConfirmation(
        chatStore.value?.messages.find((message) => message.pendingActionConfirmationId)?.pendingActionConfirmationId ??
            ''
    );
}

function createGuardedActions(ratioExpectedValue = 2) {
    return [
        {
            type: 'setDeviceParameter' as const,
            payload: {
                deviceId: COMPRESSOR_ID,
                paramId: 'comp-threshold',
                value: -18,
                expectedTrackId: 'track-bass-di',
                expectedDeviceType: 'builtin-compressor',
                expectedDeviceIds: DEVICE_IDS,
                expectedValue: -24,
                expectedTrackFrozen: false,
            },
        },
        {
            type: 'setDeviceParameter' as const,
            payload: {
                deviceId: COMPRESSOR_ID,
                paramId: 'comp-ratio',
                value: 4,
                expectedTrackId: 'track-bass-di',
                expectedDeviceType: 'builtin-compressor',
                expectedDeviceIds: DEVICE_IDS,
                expectedValue: ratioExpectedValue,
                expectedTrackFrozen: false,
            },
        },
    ];
}

describe('Bass DI compressor parameter prompt workflow', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        runtimeMocks.backend.value = 'webllm';
        runtimeMocks.failedRuntimeWrites.clear();
        runtimeMocks.runtimeParameterValues.clear();
        for (const [paramId, value] of Object.entries(INITIAL_PARAMETERS)) {
            runtimeMocks.runtimeParameterValues.set(paramId, value);
        }
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
        resetCrdtProjectAuthority('Bass DI compressor parameter workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        configureAiWorkflowCommandPreflightFixture();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        clearAiHistory();
        clearPendingActionConfirmations();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        const bassDi = createTrack('track-bass-di', 'Bass DI');
        bassDi.devices = [
            createDevice('device-bass-di-eq', 'EQ', 'builtin-eq'),
            createDevice(COMPRESSOR_ID, 'Compressor', 'builtin-compressor', { ...INITIAL_PARAMETERS }),
            createDevice('device-bass-di-saturator', 'Saturator', 'builtin-saturator', { drive: 0.4 }),
        ];
        const bassAmp = createTrack('track-bass-amp', 'Bass Amp');
        bassAmp.devices = [
            createDevice('device-bass-amp-compressor', 'Compressor', 'builtin-compressor', {
                ...INITIAL_PARAMETERS,
                'comp-threshold': -30,
            }),
        ];
        trackStore.set({ tracks: [bassDi, bassAmp], selectedTrackId: null, ghostClips: [] });
        chatStore.set({ messages: [], isGenerating: false, enableReasoning: true, chatMode: 'prompt' });
    });

    afterEach(async () => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        clearPendingActionConfirmations();
        resetAiWorkflowCommandPreflightFixture();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        await cloudSession.clear();
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('grounds, confirms, atomically commits, receipts, undoes, and redoes only the requested parameters', async () => {
        const bassAmpBefore = structuredClone(getTrack('track-bass-amp'));
        expect(getDeviceParameterPromptScope(PROMPT, getProjectContext())).toMatchObject({
            assignments: [
                { parameter: { id: 'comp-threshold', unit: 'dB', value: -24 }, value: -18 },
                { parameter: { id: 'comp-ratio', unit: ':1', value: 2 }, value: 4 },
            ],
            device: { id: COMPRESSOR_ID, type: 'builtin-compressor' },
            protectedParameters: [
                { id: 'comp-attack', value: 12 },
                { id: 'comp-release', value: 180 },
                { id: 'comp-makeup', value: 3 },
            ],
            track: { id: 'track-bass-di', name: 'Bass DI' },
        });
        await sendChatMessage(PROMPT);

        const providerRequest = vi.mocked(generateWebLlmCompletion).mock.calls[0]?.[1];
        expect(providerRequest).toContain(PROMPT);
        expect(providerRequest).toContain(COMPRESSOR_ID);
        expect(providerRequest).toContain('comp-threshold');
        expect(providerRequest).toContain('"unit":"dB"');
        expect(providerRequest).toContain('"value":-24');
        expect(providerRequest).toContain('"value":2');

        const confirmation = getConfirmation();
        expect(confirmation?.actions).toEqual([
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: COMPRESSOR_ID,
                    paramId: 'comp-threshold',
                    value: -18,
                    expectedTrackId: 'track-bass-di',
                    expectedDeviceType: 'builtin-compressor',
                    expectedDeviceIds: DEVICE_IDS,
                    expectedValue: -24,
                    expectedTrackFrozen: false,
                },
            },
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: COMPRESSOR_ID,
                    paramId: 'comp-ratio',
                    value: 4,
                    expectedTrackId: 'track-bass-di',
                    expectedDeviceType: 'builtin-compressor',
                    expectedDeviceIds: DEVICE_IDS,
                    expectedValue: 2,
                    expectedTrackFrozen: false,
                },
            },
        ]);
        expect(confirmation?.protectedUnchanged).toEqual([
            {
                id: `${COMPRESSOR_ID}:comp-attack`,
                name: 'Bass DI Compressor Attack = 12 ms',
            },
            {
                id: `${COMPRESSOR_ID}:comp-release`,
                name: 'Bass DI Compressor Release = 180 ms',
            },
            {
                id: `${COMPRESSOR_ID}:comp-makeup`,
                name: 'Bass DI Compressor Makeup = 3 dB',
            },
        ]);
        expect(confirmation?.actionLabels).toEqual([
            'Set "Bass DI" (track-bass-di) device "Compressor" (device-bass-di-compressor, builtin-compressor) parameter "Threshold" (comp-threshold) from -24 dB to -18 dB',
            'Set "Bass DI" (track-bass-di) device "Compressor" (device-bass-di-compressor, builtin-compressor) parameter "Ratio" (comp-ratio) from 2:1 to 4:1',
        ]);
        expect(confirmation?.approvalSnapshot.actionLabels).toEqual(confirmation?.actionLabels);
        expect(confirmation?.approvalSnapshot.protectedUnchanged).toEqual(confirmation?.protectedUnchanged);
        expect(confirmation?.affectedIds).toEqual(['track-bass-di', COMPRESSOR_ID, 'comp-threshold', 'comp-ratio']);
        // Two setDeviceParameter commands resolve broader than the single
        // bounded default, so the batch risk is broad-reversible.
        expect(confirmation?.risk).toEqual({
            level: 'broad-reversible',
            reason: 'The resolved operation is broader than its bounded default.',
        });
        const proposal = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(proposal?.content).toContain(
            '**setDeviceParameter**: Set "Bass DI" (track-bass-di) device "Compressor" (device-bass-di-compressor, builtin-compressor) parameter "Threshold" (comp-threshold) from -24 dB to -18 dB'
        );
        expect(proposal?.content).toContain(
            '**setDeviceParameter**: Set "Bass DI" (track-bass-di) device "Compressor" (device-bass-di-compressor, builtin-compressor) parameter "Ratio" (comp-ratio) from 2:1 to 4:1'
        );
        expect(proposal?.content).toContain('Approval risk: broad-reversible');
        expect(undoStore.value?.past).toEqual([]);

        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(getCompressor().parameterValues).toEqual({
            ...INITIAL_PARAMETERS,
            'comp-threshold': -18,
            'comp-ratio': 4,
        });
        expect(getTrack('track-bass-amp')).toEqual(bassAmpBefore);
        expect(runtimeMocks.updateDeviceParam).toHaveBeenNthCalledWith(
            1,
            'track-bass-di',
            COMPRESSOR_ID,
            'comp-threshold',
            -18
        );
        expect(runtimeMocks.updateDeviceParam).toHaveBeenNthCalledWith(
            2,
            'track-bass-di',
            COMPRESSOR_ID,
            'comp-ratio',
            4
        );
        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Outcome: committed');
        expect(receipt?.content).toContain(
            `**setDeviceParameter**: Set "Bass DI" (track-bass-di) device "Compressor" (${COMPRESSOR_ID}, builtin-compressor) parameter "Threshold" (comp-threshold) from -24 dB to -18 dB`
        );
        expect(receipt?.content).toContain(
            `**setDeviceParameter**: Set "Bass DI" (track-bass-di) device "Compressor" (${COMPRESSOR_ID}, builtin-compressor) parameter "Ratio" (comp-ratio) from 2:1 to 4:1`
        );
        expect(receipt?.content).toContain(`Affected IDs: track-bass-di, ${COMPRESSOR_ID}, comp-threshold`);
        expect(receipt?.content).toContain(`Affected IDs: track-bass-di, ${COMPRESSOR_ID}, comp-ratio`);
        expect(receipt?.content).toContain('Protected unchanged: "Bass DI Compressor Attack = 12 ms"');
        expect(receipt?.content).toContain('"Bass DI Compressor Release = 180 ms"');
        expect(receipt?.content).toContain('"Bass DI Compressor Makeup = 3 dB"');
        expect(undoStore.value?.past).toHaveLength(2);

        expect(setDeviceParameter(COMPRESSOR_ID, 'comp-attack', 20)).toBe(true);

        await undo();

        expect(getCompressor().parameterValues).toEqual({ ...INITIAL_PARAMETERS, 'comp-attack': 20 });
        expect(getTrack('track-bass-amp')).toEqual(bassAmpBefore);

        await redo();

        expect(getCompressor().parameterValues).toEqual({
            ...INITIAL_PARAMETERS,
            'comp-threshold': -18,
            'comp-ratio': 4,
            'comp-attack': 20,
        });
        expect(getTrack('track-bass-amp')).toEqual(bassAmpBefore);
    });

    it('preserves cancellation for the exact parameter prompt before confirmation or writes', async () => {
        const before = structuredClone(trackStore.value);

        await sendChatMessage(CANCELLED_PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(trackStore.value).toEqual(before);
        expect(runtimeMocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
        const cancellationMessage = chatStore.value?.messages.at(-1);
        expect(cancellationMessage?.role).toBe('assistant');
        expect(cancellationMessage?.content).toContain('Command not executed:');
    });

    it('normalizes the hosted provider to the same guarded parameter batch and exact receipt', async () => {
        runtimeMocks.backend.value = 'cloud';

        await sendChatMessage(PROMPT);

        const body = runtimeMocks.fetch.mock.calls[0]?.[1]?.body;
        expect(typeof body).toBe('string');
        expect(body).toContain('device-bass-di-compressor');
        expect(getConfirmation()?.actions).toEqual(createGuardedActions());

        const confirmation = getConfirmation();
        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        const receipt = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(receipt?.content).toContain('Affected IDs: track-bass-di, device-bass-di-compressor, comp-threshold');
        expect(receipt?.content).toContain('Affected IDs: track-bass-di, device-bass-di-compressor, comp-ratio');
        expect(receipt?.content).toContain('Bass DI Compressor Makeup = 3 dB');
    });

    it.each([
        ['omission', JSON.stringify([providerPlan[0]])],
        [
            'enlargement',
            JSON.stringify([
                ...providerPlan,
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: COMPRESSOR_ID, paramId: 'comp-attack', value: 30 },
                },
            ]),
        ],
        [
            'out-of-bounds value',
            JSON.stringify([
                {
                    name: 'setDeviceParameter',
                    arguments: { deviceId: COMPRESSOR_ID, paramId: 'comp-threshold', value: -80 },
                },
                providerPlan[1],
            ]),
        ],
        [
            'non-finite value',
            '[{"name":"setDeviceParameter","arguments":{"deviceId":"device-bass-di-compressor","paramId":"comp-threshold","value":null}},{"name":"setDeviceParameter","arguments":{"deviceId":"device-bass-di-compressor","paramId":"comp-ratio","value":4}}]',
        ],
    ])('rejects provider %s before confirmation or mutation', async (_label, response) => {
        runtimeMocks.generateWebLlmCompletion.mockResolvedValue(response);
        const before = structuredClone(trackStore.value);

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(trackStore.value).toEqual(before);
        expect(runtimeMocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects duplicate compressor identity on Bass DI before confirmation', async () => {
        const state = trackStore.value;
        if (!state) {
            throw new Error('Expected track state');
        }
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-bass-di'
                    ? {
                          ...track,
                          devices: [
                              ...track.devices,
                              createDevice('device-bass-di-compressor-duplicate', 'Compressor', 'builtin-compressor', {
                                  ...INITIAL_PARAMETERS,
                              }),
                          ],
                      }
                    : track
            ),
        });

        await sendChatMessage(PROMPT);

        expect(getConfirmation()).toBeNull();
        expect(runtimeMocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects a later guarded conflict before the first runtime or project write', async () => {
        const result = await executeAppActionBatch(createGuardedActions(999), {
            requireCompensation: true,
            source: 'prompt',
        });

        expect(result).toMatchObject({ status: 'conflicted', actions: [] });
        expect(getCompressor().parameterValues).toEqual(INITIAL_PARAMETERS);
        expect(runtimeMocks.runtimeParameterValues.get('comp-threshold')).toBe(-24);
        expect(runtimeMocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it.each(['write', 'touch', 'latch'] as const)(
        'rolls back %s-mode parameter automation buffered by a failed atomic batch',
        async (automationMode) => {
            const parameterId = `${COMPRESSOR_ID}:comp-threshold`;
            const baselinePoints = [
                { beat: 0, value: -24, curve: 'linear' as const, tension: 0 },
                { beat: 32, value: -20, curve: 'linear' as const, tension: 0 },
            ];
            trackStore.set({
                ...trackStore.value!,
                tracks: trackStore.value!.tracks.map((track) =>
                    track.id === 'track-bass-di' ? { ...track, automationMode } : track
                ),
            });
            automationStore.set({
                lanes: [
                    {
                        id: 'lane-bass-di-threshold',
                        trackId: 'track-bass-di',
                        parameterId,
                        parameterName: 'Threshold',
                        points: baselinePoints.map((point) => ({ ...point })),
                        objects: [],
                        visible: true,
                        enabled: true,
                        collapsed: false,
                        minValue: -60,
                        maxValue: 0,
                    },
                ],
            });
            transportStore.set({
                ...defaultTransportState,
                isPlaying: true,
                playheadPosition: 4,
                tempo: 120,
            });
            setAutomationRecordingDependencies({
                getAudioContext: () => ({ baseLatency: 0, outputLatency: 0 }) as AudioContext,
                getCompensationDelay: () => 0,
            });
            startAutomationRecording();
            recordAutomationValue('track-bass-di', parameterId, -22, 2);
            releaseTouchAutomation('track-bass-di', parameterId);
            const preBatchLane = structuredClone(automationStore.value?.lanes[0]);
            if (!preBatchLane) {
                throw new Error('Expected the pre-existing threshold lane');
            }
            const preExistingPendingPoint = { beat: 3, value: -21, curve: 'linear' as const, tension: 0 };
            recordAutomationValue(
                'track-bass-di',
                parameterId,
                preExistingPendingPoint.value,
                preExistingPendingPoint.beat
            );
            let preExistingBasePoints = preBatchLane.points;
            if (automationMode !== 'touch') {
                preExistingBasePoints = preBatchLane.points.filter((point) => point.beat < 2 || point.beat > 3);
            }
            const expectedPreExistingLane = {
                ...preBatchLane,
                points: [...preExistingBasePoints, preExistingPendingPoint].sort(
                    (left, right) => left.beat - right.beat
                ),
            };

            const result = await executeAppActionBatch(createGuardedActions(999), {
                requireCompensation: true,
                source: 'prompt',
            });
            stopAutomationRecording();

            expect(result).toMatchObject({ status: 'conflicted', actions: [] });
            expect(automationStore.value?.lanes).toEqual([expectedPreExistingLane]);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toEqual([]);

            await undo();
            expect(automationStore.value?.lanes[0]?.points).toEqual(baselinePoints);
            await redo();
            expect(automationStore.value?.lanes).toEqual([expectedPreExistingLane]);
        }
    );

    it('does not enter runtime rollback when preflight detects the later domain conflict', async () => {
        runtimeMocks.failedRuntimeWrites.add('comp-threshold:-24');

        const result = await executeAppActionBatch(createGuardedActions(999), {
            requireCompensation: true,
            source: 'prompt',
        });

        expect(result).toMatchObject({ status: 'conflicted', actions: [] });
        expect(getCompressor().parameterValues).toEqual(INITIAL_PARAMETERS);
        expect(runtimeMocks.runtimeParameterValues.get('comp-threshold')).toBe(-24);
        expect(runtimeMocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('conflicts a confirmed batch after Bass DI freezes without any project, runtime, receipt, or history write', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        simulateCollaboratorFreeze(true);
        runtimeMocks.updateDeviceParam.mockClear();

        const result = await confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' });

        expect(result).toMatchObject({ status: 'failed' });
        expect(getCompressor().parameterValues).toEqual(INITIAL_PARAMETERS);
        expect(runtimeMocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toEqual([]);
        expect(aiActionHistoryStore.value?.groups).toEqual([]);
        const terminalMessage = chatStore.value?.messages.find(
            (message) => message.pendingActionConfirmationId === confirmation?.id
        );
        expect(terminalMessage?.pendingActionConfirmationStatus).toBe('failed');
        expect(terminalMessage?.content).not.toContain('Outcome: committed');
        expect(terminalMessage?.content).not.toContain('Executed after confirmation');
    });

    it('keeps grouped redo whole and retryable when a collaborator freezes Bass DI', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });
        await undo();
        expect(getCompressor().parameterValues).toEqual(INITIAL_PARAMETERS);
        expect(undoStore.value?.future).toHaveLength(2);

        simulateCollaboratorFreeze(true);
        runtimeMocks.updateDeviceParam.mockClear();
        await redo();

        expect(getCompressor().parameterValues).toEqual(INITIAL_PARAMETERS);
        expect(runtimeMocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(undoStore.value?.future).toHaveLength(2);

        simulateCollaboratorFreeze(false);
        await redo();
        expect(getCompressor().parameterValues).toEqual({
            ...INITIAL_PARAMETERS,
            'comp-threshold': -18,
            'comp-ratio': 4,
        });
        expect(undoStore.value?.future).toEqual([]);
    });

    it('keeps grouped undo and redo atomic across collaborator conflicts', async () => {
        await sendChatMessage(PROMPT);
        const confirmation = getConfirmation();
        await expect(confirmPendingChatActions({ confirmationId: confirmation?.id ?? '' })).resolves.toEqual({
            status: 'executed',
        });

        expect(setDeviceParameter(COMPRESSOR_ID, 'comp-threshold', -16)).toBe(true);
        await undo();

        expect(getCompressor().parameterValues).toEqual({
            ...INITIAL_PARAMETERS,
            'comp-threshold': -16,
            'comp-ratio': 4,
        });
        expect(undoStore.value?.past).toHaveLength(2);
        expect(undoStore.value?.future).toEqual([]);

        expect(setDeviceParameter(COMPRESSOR_ID, 'comp-threshold', -18)).toBe(true);
        await undo();
        expect(getCompressor().parameterValues).toEqual(INITIAL_PARAMETERS);

        expect(setDeviceParameter(COMPRESSOR_ID, 'comp-threshold', -22)).toBe(true);
        await redo();
        expect(getCompressor().parameterValues).toEqual({
            ...INITIAL_PARAMETERS,
            'comp-threshold': -22,
        });
        expect(undoStore.value?.future).toHaveLength(2);

        expect(setDeviceParameter(COMPRESSOR_ID, 'comp-threshold', -24)).toBe(true);
        await redo();
        expect(getCompressor().parameterValues).toEqual({
            ...INITIAL_PARAMETERS,
            'comp-threshold': -18,
            'comp-ratio': 4,
        });
    });
});
