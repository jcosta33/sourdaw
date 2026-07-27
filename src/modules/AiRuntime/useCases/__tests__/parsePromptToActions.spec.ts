import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AiRuntimeConfigurationChangedError } from '../../errors/AiRuntimeConfigurationChangedError';
import { type ProjectContext } from '../../models/ProjectContext';
import { tryPresetMatch, tryParameterizedPath, tryCompoundFastPath } from '../../transformers/promptParser/parsing';
import { getProjectContext } from '../getProjectContext';
import { isDsoBackendAvailable } from '../llmOrchestration/backendResolution/isDsoBackendAvailable';
import { generateToolCalls } from '../llmOrchestration/inference';
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
    generateToolCalls: vi.fn(),
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

describe('parsePromptToActions', () => {
    beforeEach(() => {
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
        vi.mocked(isDsoBackendAvailable).mockReturnValue(false);
        vi.mocked(getProjectContext).mockReturnValue(baseContext);
        vi.mocked(generateToolCalls).mockReset();
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

    it('turns provider tool calls into validated action proposals', async () => {
        const currentContext = { ...baseContext, tempo: 121 };
        vi.mocked(getProjectContext).mockReturnValue(currentContext);
        vi.mocked(generateToolCalls).mockResolvedValue([
            { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
        ]);
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

    it('does not partially accept a provider batch containing a rejected call', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue([
            { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
            { name: 'removeTrack', arguments: { trackId: 'track-vocals' } },
        ]);
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

    it('preserves configuration-change cancellation instead of reporting no actions', async () => {
        vi.mocked(generateToolCalls).mockRejectedValue(new AiRuntimeConfigurationChangedError());

        await expect(parsePromptToActions('mute the vocals', baseContext)).rejects.toMatchObject({
            name: 'AiRuntimeConfigurationChangedError',
        });

        expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('Provider tool planning failed'));
    });

    it('returns multiple valid provider actions as one complete batch proposal', async () => {
        vi.mocked(generateToolCalls).mockResolvedValue([
            { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
            { name: 'setTrackPan', arguments: { trackId: 'track-guitar', pan: -20 } },
        ]);
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
