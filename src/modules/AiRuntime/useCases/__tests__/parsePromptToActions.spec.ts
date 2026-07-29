import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type ProjectContext } from '../../models/ProjectContext';
import { tryPresetMatch, tryParameterizedPath, tryCompoundFastPath } from '../../transformers/promptParser/parsing';
import { executeDsoEdit } from '../dsoEditor/executeDsoEdit';
import { getProjectContext } from '../getProjectContext';
import { isDsoBackendAvailable } from '../llmOrchestration/backendResolution/isDsoBackendAvailable';
import { generateToolPlanningOutcome as generateToolCalls } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

const {
    mockLogger,
    mockBridgeLlmToolCalls,
    mockBuildLlmActionSystemPrompt,
    mockBuildLlmActionUserMessage,
    executableToolSchemas,
} = vi.hoisted(() => ({
    mockLogger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
    mockBridgeLlmToolCalls: vi.fn(),
    mockBuildLlmActionSystemPrompt: vi.fn(() => 'command system prompt'),
    mockBuildLlmActionUserMessage: vi.fn(() => 'command user message'),
    executableToolSchemas: [{ type: 'function', function: { name: 'muteTrack' } }],
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mockLogger,
}));

vi.mock('../../transformers/promptParser/parsing', () => ({
    tryPresetMatch: vi.fn(() => []),
    buildPresetContext: vi.fn(() => ({})),
    tryParameterizedPath: vi.fn(() => []),
    tryCompoundFastPath: vi.fn(() => null),
    requiresConfirmation: vi.fn(() => false),
}));

vi.mock('../llmOrchestration/backendResolution/isDsoBackendAvailable', () => ({
    isDsoBackendAvailable: vi.fn(() => false),
}));

vi.mock('../getProjectContext', () => ({
    getProjectContext: vi.fn(),
}));

vi.mock('../llmOrchestration/inference', () => ({
    generateToolPlanningOutcome: vi.fn(),
}));

vi.mock('../dsoEditor/executeDsoEdit', () => ({
    executeDsoEdit: vi.fn(),
}));

vi.mock('../../transformers/llmActionBridge', () => ({
    bridgeLlmToolCalls: mockBridgeLlmToolCalls,
    buildLlmActionSystemPrompt: mockBuildLlmActionSystemPrompt,
    buildLlmActionUserMessage: mockBuildLlmActionUserMessage,
    LLM_EXECUTABLE_TOOL_SCHEMAS: executableToolSchemas,
}));

const baseContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
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
        vi.mocked(isDsoBackendAvailable).mockReturnValue(false);
        vi.mocked(getProjectContext).mockReturnValue(baseContext);
        vi.mocked(generateToolCalls).mockReset();
        vi.mocked(executeDsoEdit).mockReset();
        vi.mocked(executeDsoEdit).mockResolvedValue({
            success: false,
            plan: null,
            summaries: [],
            error: 'No DSO match',
        });
        mockBridgeLlmToolCalls.mockReset();
        mockBuildLlmActionSystemPrompt.mockClear();
        mockBuildLlmActionUserMessage.mockClear();
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
    ] as const)('recognizes denied intent $prompt without provider or DSO planning', async ({ prompt, actionType }) => {
        vi.mocked(isDsoBackendAvailable).mockReturnValue(true);

        const result = await parsePromptToActions(prompt, baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: prompt,
            requiresConfirmation: false,
            rejectionReason: `Action ${actionType} cannot be executed by AI because it does not report completion.`,
        });
        expect(generateToolCalls).not.toHaveBeenCalled();
        expect(executeDsoEdit).not.toHaveBeenCalled();
    });

    it('turns provider tool calls into validated action proposals', async () => {
        const currentContext = { ...baseContext, tempo: 121 };
        vi.mocked(getProjectContext).mockReturnValue(currentContext);
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } }])
        );
        mockBridgeLlmToolCalls.mockReturnValue({
            actions: [{ type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } }],
            rejections: [],
        });

        const result = await parsePromptToActions('mute the vocals', baseContext);

        expect(generateToolCalls).toHaveBeenCalledWith(
            'command system prompt',
            'command user message',
            executableToolSchemas,
            undefined
        );
        expect(mockBuildLlmActionUserMessage).toHaveBeenCalledWith({
            prompt: 'mute the vocals',
            context: baseContext,
        });
        expect(mockBridgeLlmToolCalls).toHaveBeenCalledWith({
            calls: [{ name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } }],
            context: currentContext,
        });
        expect(result.actions).toEqual([{ type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } }]);
        expect(result.executionMode).toBe('atomic');
    });

    it('requires confirmation for a multi-action provider plan', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'setTrackGain', arguments: { trackId: 'track-guitar', gain: 0.6 } },
            ])
        );
        mockBridgeLlmToolCalls.mockReturnValue({
            actions: [
                { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
                { type: 'setTrackGain', payload: { trackId: 'track-guitar', gain: 0.6 } },
            ],
            rejections: [],
        });

        const result = await parsePromptToActions('mute vocals and lower guitar', baseContext);

        expect(result.requiresConfirmation).toBe(true);
        expect(result.executionMode).toBe('atomic');
    });

    it('does not partially accept a provider batch containing a rejected call', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'removeTrack', arguments: { trackId: 'track-vocals' } },
            ])
        );
        mockBridgeLlmToolCalls.mockReturnValue({
            actions: [{ type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } }],
            rejections: [{ index: 1, name: 'removeTrack', reason: 'Tool is not allowlisted' }],
        });

        const result = await parsePromptToActions('mute and delete the vocals', baseContext);

        expect(result.actions).toEqual([]);
        expect(mockLogger.warn).toHaveBeenCalledWith(
            '[AI] Rejected tool call 1 (removeTrack): Tool is not allowlisted'
        );
    });

    it('returns the provider bridge rejection reason without falling through to DSO', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(
            completePlan([{ name: 'removeTrack', arguments: { trackId: 'track-vocals' } }])
        );
        mockBridgeLlmToolCalls.mockReturnValue({
            actions: [],
            rejections: [{ index: 0, name: 'removeTrack', reason: 'Tool is not allowlisted' }],
        });
        vi.mocked(isDsoBackendAvailable).mockReturnValue(true);

        const result = await parsePromptToActions('delete the vocals', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'delete the vocals',
            requiresConfirmation: false,
            rejectionReason: 'Provider action rejected: removeTrack: Tool is not allowlisted',
        });
    });

    it('returns a rejection when runtime validation filters a provider batch', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([{ name: 'saveProject', arguments: {} }]));
        mockBridgeLlmToolCalls.mockReturnValue({
            actions: [{ type: 'saveProject' }],
            rejections: [],
        });
        vi.mocked(isDsoBackendAvailable).mockReturnValue(true);

        const result = await parsePromptToActions('save the project', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'save the project',
            requiresConfirmation: false,
            rejectionReason: 'Provider action failed runtime validation: saveProject',
        });
    });

    it('returns a rejected provider planning outcome without bridging or falling through to DSO', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue({
            status: 'rejected',
            reason: 'Native text tool planning did not complete (finish_reason: length)',
        });
        vi.mocked(isDsoBackendAvailable).mockReturnValue(true);

        const result = await parsePromptToActions('mute the vocals', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
            rejectionReason:
                'Provider planning rejected: Native text tool planning did not complete (finish_reason: length)',
        });
        expect(mockBridgeLlmToolCalls).not.toHaveBeenCalled();
        expect(executeDsoEdit).not.toHaveBeenCalled();
    });

    it.each([
        'Provider refused tool planning',
        'Provider returned an invalid tool plan',
        'Provider returned an incomplete tool plan',
    ])('returns provider planning failure %s without falling through to DSO', async (reason) => {
        vi.mocked(generateToolCalls).mockRejectedValue(new Error(reason));
        vi.mocked(isDsoBackendAvailable).mockReturnValue(true);

        const result = await parsePromptToActions('mute the vocals', baseContext);

        expect(result).toEqual({
            actions: [],
            rawText: 'mute the vocals',
            requiresConfirmation: false,
            rejectionReason: `Provider planning failed: ${reason}`,
        });
        expect(executeDsoEdit).not.toHaveBeenCalled();
    });

    it('allows DSO fallback after successful provider planning returns no tool calls', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue(completePlan([]));
        mockBridgeLlmToolCalls.mockReturnValue({ actions: [], rejections: [] });
        vi.mocked(isDsoBackendAvailable).mockReturnValue(true);

        const result = await parsePromptToActions('make the mix warmer', baseContext);

        expect(executeDsoEdit).toHaveBeenCalledWith('make the mix warmer', undefined);
        expect(result).toEqual({
            actions: [],
            rawText: 'make the mix warmer',
            requiresConfirmation: false,
            _jsonEditAttempted: true,
        });
    });

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
        mockBridgeLlmToolCalls.mockReturnValue({
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
