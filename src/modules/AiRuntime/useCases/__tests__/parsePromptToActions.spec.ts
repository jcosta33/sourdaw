import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { AiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type ProjectContext } from '../../models/ProjectContext';
import { tryPresetMatch, tryParameterizedPath, tryCompoundFastPath } from '../../transformers/promptParser/parsing';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome as generateToolCalls } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

const { mockLogger, mockBridgeGroundedLlmToolCalls, mockBuildLlmActionSystemPrompt, mockBuildLlmActionUserMessage } =
    vi.hoisted(() => ({
        mockLogger: {
            warn: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
        },
        mockBridgeGroundedLlmToolCalls: vi.fn(),
        mockBuildLlmActionSystemPrompt: vi.fn(() => 'command system prompt'),
        mockBuildLlmActionUserMessage: vi.fn(() => 'command user message'),
    }));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

vi.mock('../../transformers/promptParser/parsing', () => ({
    tryPresetMatch: vi.fn(() => []),
    buildPresetContext: vi.fn(() => ({})),
    tryParameterizedPath: vi.fn(() => []),
    tryCompoundFastPath: vi.fn(() => null),
}));

vi.mock('../getProjectContext', () => ({
    getProjectContext: vi.fn(),
}));

vi.mock('../llmOrchestration/inference', () => ({
    generateToolPlanningOutcome: vi.fn(),
}));

vi.mock('../agentReference/bridgeGroundedLlmToolCalls', () => ({
    bridgeGroundedLlmToolCalls: mockBridgeGroundedLlmToolCalls,
}));

vi.mock('../../transformers/llmActionBridge', async () => {
    const actual = await vi.importActual<typeof import('../../transformers/llmActionBridge')>(
        '../../transformers/llmActionBridge'
    );
    return {
        ...actual,
        buildLlmActionSystemPrompt: mockBuildLlmActionSystemPrompt,
        buildLlmActionUserMessage: mockBuildLlmActionUserMessage,
    };
});

const baseContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function completePlan<TToolCall>(toolCalls: TToolCall[]) {
    return { status: 'complete' as const, toolCalls };
}

describe('parsePromptToActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
        vi.mocked(getProjectContext).mockReturnValue(baseContext);
        vi.mocked(generateToolCalls).mockReset();
        mockBridgeGroundedLlmToolCalls.mockReset();
        mockBuildLlmActionSystemPrompt.mockClear();
        mockBuildLlmActionUserMessage.mockClear();
    });

    it.each([
        {
            prompt: 'set tempo to 128',
            action: { type: 'setTempo' as const, payload: { bpm: 128 } },
            producer: 'parameterized' as const,
        },
        {
            prompt: 'remove all tracks',
            action: { type: 'removeAllTracks' as const },
            producer: 'preset' as const,
        },
    ])('applies app-owned confirmation policy to a single $producer action', async ({ prompt, action, producer }) => {
        if (producer === 'parameterized') {
            vi.mocked(tryParameterizedPath).mockReturnValue([action]);
        } else {
            vi.mocked(tryPresetMatch).mockReturnValue([action]);
        }

        const result = await parsePromptToActions(prompt, baseContext);

        expect(result.actions).toEqual([action]);
        expect(result.requiresConfirmation).toBe(true);
    });

    it('requires confirmation for a multi-action compound fast path', async () => {
        const actions = [
            { type: 'muteTrack' as const, payload: { trackId: 'track-vocals', muted: true } },
            { type: 'setTrackGain' as const, payload: { trackId: 'track-guitar', gain: 0.6 } },
        ];
        vi.mocked(tryCompoundFastPath).mockReturnValue(actions);

        const result = await parsePromptToActions('mute vocals and lower guitar', baseContext);

        expect(result.actions).toEqual(actions);
        expect(result.requiresConfirmation).toBe(true);
    });

    it('should return empty intent when signal is aborted before LLM path', async () => {
        const controller = new AbortController();
        controller.abort();

        const result = await parsePromptToActions('anything', baseContext, controller.signal);

        expect(result).toEqual({
            actions: [],
            rawText: 'anything',
            requiresConfirmation: false,
        });
    });

    it.each([
        { prompt: 'save project', actionType: 'saveProject' },
        { prompt: 'new project', actionType: 'newProject' },
        { prompt: 'export', actionType: 'exportProject' },
        { prompt: 'import audio', actionType: 'importAudioFile' },
        { prompt: 'import midi', actionType: 'importMidiFile' },
        { prompt: 'leave session', actionType: 'leaveCollabSession' },
    ] as const)('recognizes denied intent $prompt without provider planning', async ({ prompt, actionType }) => {
        const result = await parsePromptToActions(prompt, baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: prompt,
            requiresConfirmation: false,
            rejectionReason: `Action ${actionType} cannot be executed by AI because it does not report completion.`,
        });
        expect(generateToolCalls).not.toHaveBeenCalled();
    });

    it('turns provider tool calls into validated proposals against the frozen planning context', async () => {
        const currentContext = { ...baseContext, tempo: 121 };
        vi.mocked(getProjectContext).mockReturnValue(currentContext);
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'setTempo', arguments: { bpm: 128 } }]));
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            rejections: [],
        });

        const result = await parsePromptToActions('make the project faster', baseContext);

        expect(generateToolCalls).toHaveBeenCalledWith(
            'command system prompt',
            'command user message',
            getExecutableAppActionToolSchemas(),
            undefined,
            'make the project faster'
        );
        expect(mockBuildLlmActionUserMessage).toHaveBeenCalledWith({
            prompt: 'make the project faster',
            context: baseContext,
        });
        expect(mockBridgeGroundedLlmToolCalls).toHaveBeenCalledWith({
            calls: [{ name: 'setTempo', arguments: { bpm: 128 } }],
            context: baseContext,
            prompt: 'make the project faster',
        });
        expect(result.actions).toEqual([{ type: 'setTempo', payload: { bpm: 128 } }]);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes an explicit provider time-signature command as one confirmable atomic action', async () => {
        const actualBridge = await vi.importActual<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>(
            '../agentReference/bridgeGroundedLlmToolCalls'
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setTimeSignature', arguments: { numerator: 7, denominator: 8 } }])
        );

        const result = await parsePromptToActions('set time signature to 7/8', baseContext);

        expect(result.actions).toEqual([{ type: 'setTimeSignature', payload: { numerator: 7, denominator: 8 } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes a grounded whole-clip MIDI transform as one confirmable atomic action', async () => {
        const actualBridge = await vi.importActual<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>(
            '../agentReference/bridgeGroundedLlmToolCalls'
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    id: 'track-piano',
                    name: 'Piano',
                    kind: 'midi',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 1,
                    deviceCount: 0,
                    clips: [
                        {
                            id: 'clip-piano-midi',
                            name: 'Piano MIDI',
                            type: 'midi',
                            startBeat: 0,
                            endBeat: 8,
                            noteCount: 4,
                        },
                    ],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-piano',
            selectedClipId: 'clip-piano-midi',
            selectedClipIds: ['clip-piano-midi'],
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'quantizeNoteLengths', arguments: { clipId: 'clip-piano-midi', gridSize: 0.25 } }])
        );

        const result = await parsePromptToActions(
            'quantize note lengths in Piano MIDI to a 0.25 beat grid',
            providerContext
        );

        expect(result.actions).toEqual([
            { type: 'quantizeNoteLengths', payload: { clipId: 'clip-piano-midi', gridSize: 0.25 } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes a grounded provider arm command as one confirmable atomic action', async () => {
        const actualBridge = await vi.importActual<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>(
            '../agentReference/bridgeGroundedLlmToolCalls'
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    id: 'track-vocals',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-vocals',
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'armTrack', arguments: { trackId: 'track-vocals', armed: true } }])
        );

        const result = await parsePromptToActions('arm Vocals for recording', providerContext);

        expect(result.actions).toEqual([{ type: 'armTrack', payload: { trackId: 'track-vocals', armed: true } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes a provider bus creation as one bounded atomic action', async () => {
        const actualBridge = await vi.importActual<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>(
            '../agentReference/bridgeGroundedLlmToolCalls'
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'createBus', arguments: { name: 'Parallel Reverb' } }])
        );

        const result = await parsePromptToActions('create a bus called Parallel Reverb', baseContext);

        expect(result.actions).toEqual([{ type: 'createBus', payload: { name: 'Parallel Reverb' } }]);
        expect(result.requiresConfirmation).toBe(false);
        expect(result.executionMode).toBe('atomic');
    });

    it('materializes one stable bus identity across a dependent provider action batch', async () => {
        const actualBridge = await vi.importActual<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>(
            '../agentReference/bridgeGroundedLlmToolCalls'
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const vocals = {
            id: 'track-vocals',
            name: 'Vocals',
            kind: 'audio',
            muted: false,
            soloed: false,
            armed: false,
            gain: 0.8,
            pan: 0,
            automationMode: 'read' as const,
            outputId: 'master',
            clipCount: 0,
            deviceCount: 0,
            clips: [],
            devices: [],
            sends: [],
        };
        const providerContext: ProjectContext = {
            ...baseContext,
            availableDeviceTypes: [{ id: 'builtin-reverb', name: 'Reverb' }],
            tracks: [vocals],
            selectedTrackId: vocals.id,
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'createBus', arguments: { name: 'Vocal Plate', binding: 'vocal-plate' } },
                { name: 'addDevice', arguments: { trackId: '$vocal-plate', deviceType: 'Reverb' } },
                {
                    name: 'addSend',
                    arguments: { trackId: vocals.id, busId: '$vocal-plate', level: 0.25 },
                },
            ])
        );

        const result = await parsePromptToActions(
            'create a bus called Vocal Plate, add Reverb to it, and send Vocals to it at 25%',
            providerContext
        );

        const createBus = result.actions[0];
        const addDevice = result.actions[1];
        const addSend = result.actions[2];
        if (createBus?.type !== 'createBus' || addDevice?.type !== 'addDevice' || addSend?.type !== 'addSend') {
            throw new Error('Expected one materialized compound bus batch');
        }
        expect(createBus.payload.busId).toMatch(/^bus-ai-/u);
        expect(addDevice.payload.trackId).toBe(createBus.payload.busId);
        expect(addSend.payload.busId).toBe(createBus.payload.busId);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('proposes grounded provider track deletion as one confirmable atomic action', async () => {
        const actualBridge = await vi.importActual<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>(
            '../agentReference/bridgeGroundedLlmToolCalls'
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                {
                    id: 'track-vocals',
                    name: 'Vocals',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    automationMode: 'read',
                    outputId: 'master',
                    clipCount: 0,
                    deviceCount: 0,
                    clips: [],
                    devices: [],
                    sends: [],
                },
            ],
            selectedTrackId: 'track-vocals',
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'removeTrack', arguments: { trackId: 'track-vocals' } }])
        );

        const result = await parsePromptToActions('delete the Vocals track', providerContext);

        expect(result.actions).toEqual([{ type: 'removeTrack', payload: { trackId: 'track-vocals' } }]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('rejects a provider time signature that does not match the prompt', async () => {
        const actualBridge = await vi.importActual<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>(
            '../agentReference/bridgeGroundedLlmToolCalls'
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'setTimeSignature', arguments: { numerator: 4, denominator: 4 } }])
        );

        const result = await parsePromptToActions('set time signature to 7/8', baseContext);

        expect(result.actions).toEqual([]);
        expect(result.rejectionReason).toContain('does not match the user request');
    });

    it('requires confirmation for a grounded multi-action provider plan', async () => {
        const actualBridge = await vi.importActual<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>(
            '../agentReference/bridgeGroundedLlmToolCalls'
        );
        mockBridgeGroundedLlmToolCalls.mockImplementation(actualBridge.bridgeGroundedLlmToolCalls);
        const providerContext: ProjectContext = {
            ...baseContext,
            tracks: [
                { id: 'track-vocals', name: 'Vocals' },
                { id: 'track-guitar', name: 'Guitar' },
            ].map(({ id, name }) => ({
                id,
                name,
                kind: 'audio',
                muted: false,
                soloed: false,
                armed: false,
                gain: 0.8,
                pan: 0,
                automationMode: 'read',
                outputId: 'master',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
                sends: [],
            })),
        };
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'setTrackGain', arguments: { trackId: 'track-guitar', gain: 0.6 } },
            ])
        );

        const result = await parsePromptToActions('mute Vocals and lower Guitar', providerContext);

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
            { type: 'setTrackGain', payload: { trackId: 'track-guitar', gain: 0.6 } },
        ]);
        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('does not partially accept a provider batch containing a rejected call', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'saveProject', arguments: {} },
            ])
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } }],
            rejections: [{ index: 1, name: 'saveProject', reason: 'Tool is not allowlisted' }],
        });

        const result = await parsePromptToActions('mute the vocals and save the project', baseContext);

        expect(result.actions).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AI] Rejected tool call 1 (saveProject): Tool is not allowlisted'
        );
    });

    it('returns the provider bridge rejection reason without producing actions', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'saveProject', arguments: {} }]));
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [],
            rejections: [{ index: 0, name: 'saveProject', reason: 'Tool is not allowlisted' }],
        });

        const result = await parsePromptToActions('save the project', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'save the project',
            requiresConfirmation: false,
            rejectionReason: 'Provider action rejected: saveProject: Tool is not allowlisted',
        });
    });

    it('returns a rejection when runtime validation filters a provider batch', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'saveProject', arguments: {} }]));
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'saveProject' }],
            rejections: [],
        });

        const result = await parsePromptToActions('save the project', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'save the project',
            requiresConfirmation: false,
            rejectionReason: 'Provider action failed runtime validation: saveProject',
        });
    });

    it('returns a rejected provider planning outcome without bridging it', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue({
            status: 'rejected',
            reason: 'Native text tool planning did not complete (finish_reason: length)',
        });

        const result = await parsePromptToActions('mute the vocals', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
            rejectionReason:
                'Provider planning rejected: Native text tool planning did not complete (finish_reason: length)',
        });
        expect(mockBridgeGroundedLlmToolCalls).not.toHaveBeenCalled();
    });

    it.each([
        'Provider refused tool planning',
        'Provider returned an invalid tool plan',
        'Provider returned an incomplete tool plan',
    ])('returns provider planning failure %s without producing actions', async (reason) => {
        vi.mocked(generateToolCalls).mockRejectedValue(new Error(reason));

        const result = await parsePromptToActions('mute the vocals', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
            rejectionReason: `Provider planning failed: ${reason}`,
        });
    });

    it.each(['set tempo to 128', 'create a send from vocals to reverb'])(
        'returns no actions for %s after an empty provider plan',
        async (prompt) => {
            vi.mocked(generateToolCalls).mockResolvedValue(completePlan([]));
            mockBridgeGroundedLlmToolCalls.mockReturnValue({ actions: [], rejections: [] });

            const result = await parsePromptToActions(prompt, baseContext);

            expect(result).toEqual({
                actions: [],
                rawText: prompt,
                requiresConfirmation: false,
            });
        }
    );

    it('preserves configuration-change cancellation instead of reporting no actions', async () => {
        vi.mocked(generateToolCalls).mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await expect(parsePromptToActions('mute the vocals', baseContext)).rejects.toMatchObject({
            name: 'AiRuntimeConfigurationChangedError',
        });

        expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Provider tool planning failed'));
    });

    it('returns multiple valid provider actions as one complete batch proposal', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'setTrackPan', arguments: { trackId: 'track-guitar', pan: -20 } },
            ])
        );
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [
                { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
                { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: -20 } },
            ],
            rejections: [],
        });

        const result = await parsePromptToActions('mute vocals and pan guitar left', baseContext);

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: -20 } },
        ]);
        expect(result.executionMode).toBe('atomic');
    });
});
