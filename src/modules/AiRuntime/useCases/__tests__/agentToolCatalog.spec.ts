import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { APPLICATION_OWNED_TOOL_SCHEMAS, runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

const { mockBridgeGroundedLlmToolCalls } = vi.hoisted(() => ({
    mockBridgeGroundedLlmToolCalls: vi.fn(),
}));

vi.mock('../../transformers/promptParser/parsing', () => ({
    tryPresetMatch: vi.fn(() => []),
    buildPresetContext: vi.fn(() => ({})),
    tryParameterizedPath: vi.fn(() => []),
    tryCompoundFastPath: vi.fn(() => null),
}));

vi.mock('../llmOrchestration/inference', () => ({
    generateToolPlanningOutcome: vi.fn(),
}));

vi.mock('../agentReference/bridgeGroundedLlmToolCalls', () => ({
    bridgeGroundedLlmToolCalls: mockBridgeGroundedLlmToolCalls,
}));

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('agent tool catalog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockBridgeGroundedLlmToolCalls.mockReset();
    });

    it('keeps provider planning on a compact catalog, discovers command schemas dynamically, and returns only a proposal', async () => {
        expect(APPLICATION_OWNED_TOOL_SCHEMAS.map((schema: ToolSchema) => schema.function.name)).toEqual([
            'project.query',
            'project.resolve',
            'agent.capabilities',
            'agent.catalog.discover',
            'command.batch.preview',
            'command.batch.propose',
            'command.batch.commit',
            'command.history',
            'render.request',
            'analysis.request',
            'command.approval',
        ]);

        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'catalog-1',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['setTempo'] },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'proposal-1',
                        name: 'command.batch.propose',
                        arguments: {
                            commands: [{ name: 'setTempo', arguments: { bpm: 128 } }],
                        },
                    },
                ],
            });
        mockBridgeGroundedLlmToolCalls.mockImplementation(({ calls }: { calls: unknown }) => ({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            rejections: [],
            ...(expect(calls).toEqual([{ name: 'setTempo', arguments: { bpm: 128 } }]), {}),
        }));

        const result = await parsePromptToActions('set the tempo to 128', context, undefined, 'revision-2');

        const firstTurnSchemas = vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[2] ?? [];
        expect(firstTurnSchemas.some((schema: ToolSchema) => schema.function.name === 'setTempo')).toBe(false);
        expect(firstTurnSchemas.some((schema: ToolSchema) => schema.function.name === 'agent.catalog.discover')).toBe(
            true
        );
        expect(vi.mocked(generateToolPlanningOutcome).mock.calls[1]?.[1]).toContain('catalog-1');
        expect(vi.mocked(generateToolPlanningOutcome).mock.calls[1]?.[1]).toContain('setTempo');
        expect(result.actions).toEqual([{ type: 'setTempo', payload: { bpm: 128 } }]);
    });

    it('paginates dynamically discovered command schemas as bounded correlated receipts', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'catalog-page-1',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', page: { limit: 1 } },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'catalog-page-loop',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });

        expect(result).toMatchObject({
            status: 'complete',
            receipts: [
                {
                    callId: 'catalog-page-1',
                    toolName: 'agent.catalog.discover',
                    data: {
                        page: { limit: 1, offset: 0 },
                        nextCursor: '1',
                        items: [expect.objectContaining({ function: expect.any(Object) })],
                    },
                },
            ],
        });
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('catalog-page-1');
    });
});
