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
            'command.batch.propose',
            'command.history',
            'render.request',
            'analysis.request',
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

    it('rejects a direct primitive provider call before grounding when it did not enter through a catalog proposal', async () => {
        vi.mocked(generateToolPlanningOutcome).mockResolvedValue({
            status: 'complete',
            toolCalls: [{ id: 'direct-set-tempo', name: 'setTempo', arguments: { bpm: 128 } }],
        });
        mockBridgeGroundedLlmToolCalls.mockReturnValue({
            actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
            rejections: [],
        });

        const result = await parsePromptToActions('set the tempo to 128', context, undefined, 'revision-2');

        expect(result).toMatchObject({
            actions: [],
            rejectionReason: 'Provider planning rejected: Provider requested an unavailable application tool.',
        });
        expect(mockBridgeGroundedLlmToolCalls).not.toHaveBeenCalled();
    });

    it('rejects command discovery that attempts registry enumeration and accepts only named bounded pages', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'catalog-enumeration',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', page: { limit: 1 } },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'catalog-page-1',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['setTempo'], page: { limit: 1 } },
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
                    callId: 'catalog-enumeration',
                    status: 'failure',
                    error: { code: 'invalid-tool-arguments' },
                },
                {
                    callId: 'catalog-page-1',
                    toolName: 'agent.catalog.discover',
                    data: {
                        page: { limit: 1, offset: 0 },
                        nextCursor: null,
                        items: [expect.objectContaining({ function: expect.any(Object) })],
                    },
                },
            ],
        });
        expect(requestTurn.mock.calls[2]?.[0].receiptContext).toContain('catalog-page-1');
    });

    it('routes advertised render and analysis requests through proposal validation instead of execution', async () => {
        vi.mocked(generateToolPlanningOutcome).mockResolvedValue({
            status: 'complete',
            toolCalls: [
                {
                    id: 'render-1',
                    name: 'render.request',
                    arguments: { sectionIds: ['chorus-1'] },
                },
                {
                    id: 'analysis-1',
                    name: 'analysis.request',
                    arguments: { scope: 'mix' },
                },
            ],
        });
        mockBridgeGroundedLlmToolCalls.mockImplementation(({ calls }: { calls: unknown }) => ({
            actions: [
                { type: 'renderProjectSections', payload: { sectionIds: ['chorus-1'] } },
                { type: 'analyzeMix', payload: {} },
            ],
            rejections: [],
            ...(expect(calls).toEqual([
                { name: 'renderProjectSections', arguments: { sectionIds: ['chorus-1'] } },
                { name: 'analyzeMix', arguments: {} },
            ]),
            {}),
        }));

        const result = await parsePromptToActions('render and analyze the chorus', context, undefined, 'revision-2');

        expect(mockBridgeGroundedLlmToolCalls).toHaveBeenCalledTimes(1);
        expect(result.rejectionReason ?? '').not.toContain('unavailable application tool');
    });

    it.each([
        { label: 'unknown names', arguments: { category: 'command', names: ['not-a-command'] } },
        { label: 'duplicate names', arguments: { category: 'command', names: ['setTempo', 'setTempo'] } },
        { label: 'over-limit names', arguments: { category: 'command', names: Array(9).fill('setTempo') } },
        {
            label: 'non-canonical cursor',
            arguments: { category: 'command', names: ['setTempo'], page: { cursor: '01' } },
        },
    ])('rejects $label without exposing registry enumeration', async ({ arguments: catalogArguments }) => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'invalid-catalog-request',
                        name: 'agent.catalog.discover',
                        arguments: catalogArguments,
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'invalid-catalog-loop',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });

        expect(result).toMatchObject({
            status: 'complete',
            receipts: [
                {
                    callId: 'invalid-catalog-request',
                    status: 'failure',
                    error: { code: 'invalid-tool-arguments' },
                },
            ],
        });
    });
});
