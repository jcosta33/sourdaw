import { beforeEach, describe, expect, it, vi } from 'vitest';

import { querySemanticProject } from '#/modules/Project/useCases';

import { type ProjectContext } from '../../models/ProjectContext';
import { type ToolSchema } from '../../models/ToolDefinitions';
import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { APPLICATION_OWNED_TOOL_SCHEMAS, runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

const { mockBridgeGroundedLlmToolCalls, mockLogger } = vi.hoisted(() => ({
    mockBridgeGroundedLlmToolCalls: vi.fn(),
    mockLogger: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    querySemanticProject: vi.fn(),
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

describe('application-owned tool loop', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
    });

    it('executes a bounded local project query, returns its correlated receipt, then grounds the next provider turn', async () => {
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: 'revision-2',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 1 },
            items: [{ id: 'project-1', kind: 'project', name: 'Song' }],
            nextCursor: null,
            warnings: [],
        });
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        name: 'project.query',
                        arguments: { type: 'project-summary' },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ name: 'setTempo', arguments: { bpm: 128 } }],
            });
        mockBridgeGroundedLlmToolCalls.mockImplementation(({ calls }: { calls: Array<{ name: string }> }) => {
            expect(calls).toEqual([{ name: 'setTempo', arguments: { bpm: 128 } }]);
            return {
                actions: [{ type: 'setTempo', payload: { bpm: 128 } }],
                rejections: [],
            };
        });

        const result = await parsePromptToActions(
            'inspect the project, then set tempo to 128',
            context,
            undefined,
            'revision-2'
        );

        expect(querySemanticProject).toHaveBeenCalledWith({ type: 'project-summary' });
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(2);
        const firstSchemas: readonly ToolSchema[] = vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[2] ?? [];
        expect(firstSchemas.some((schema) => schema.function.name === 'project.query')).toBe(true);
        const continuationMessage = vi.mocked(generateToolPlanningOutcome).mock.calls[1]?.[1];
        expect(continuationMessage).toMatch(/"callId":"planning-[^"]+:1:0"/);
        expect(continuationMessage).toContain('revision-2');
        expect(continuationMessage).toContain('project-summary');
        expect(result.actions).toEqual([{ type: 'setTempo', payload: { bpm: 128 } }]);
    });

    it('publishes data-only schemas and rejects unavailable tools before local execution', async () => {
        const schemas = APPLICATION_OWNED_TOOL_SCHEMAS;
        expect(schemas).toHaveLength(1);
        expect(schemas[0]?.function).toMatchObject({
            name: 'project.query',
            parameters: { additionalProperties: false },
        });
        expect(JSON.stringify(schemas)).not.toContain('execute');

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-1',
            terminalToolNames: new Set(['setTempo']),
            requestTurn: vi.fn().mockResolvedValue({
                status: 'complete',
                toolCalls: [{ id: 'unknown-1', name: 'internal.getStore', arguments: {} }],
            }),
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider requested an unavailable application tool.',
        });
        expect(querySemanticProject).not.toHaveBeenCalled();
    });

    it('returns strict-argument failures as correlated bounded receipts before allowing a retry turn', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'query-invalid',
                        name: 'project.query',
                        arguments: { type: 'project-summary', unexpected: true },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'action-1', name: 'setTempo', arguments: { bpm: 128 } }],
            });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-2',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(querySemanticProject).not.toHaveBeenCalled();
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('query-invalid');
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('invalid-tool-arguments');
        expect(result).toMatchObject({
            status: 'complete',
            receipts: [{ callId: 'query-invalid', status: 'failure' }],
        });
    });

    it('assigns missing call identities and rejects mixed read/action turns before execution', async () => {
        const mixed = await runApplicationOwnedToolLoop({
            loopId: 'loop-mixed',
            terminalToolNames: new Set(['setTempo']),
            requestTurn: vi.fn().mockResolvedValue({
                status: 'complete',
                toolCalls: [
                    { name: 'project.query', arguments: { type: 'project-summary' } },
                    { name: 'setTempo', arguments: { bpm: 128 } },
                ],
            }),
        });
        expect(mixed).toMatchObject({
            status: 'rejected',
            reason: 'Provider mixed project reads with terminal action calls in one turn.',
        });
        expect(querySemanticProject).not.toHaveBeenCalled();

        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: 'revision-2',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 0 },
            items: [],
            nextCursor: null,
            warnings: [],
        });
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ name: 'project.query', arguments: { type: 'project-summary' } }],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });
        await runApplicationOwnedToolLoop({
            loopId: 'loop-generated',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('loop-generated:1:0');
    });

    it('rejects duplicate call identities across turns', async () => {
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: 'revision-2',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 0 },
            items: [],
            nextCursor: null,
            warnings: [],
        });
        const requestTurn = vi.fn().mockResolvedValue({
            status: 'complete',
            toolCalls: [{ id: 'same-call', name: 'project.query', arguments: { type: 'project-summary' } }],
        });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-3',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider returned an invalid or duplicate tool-call identity.',
        });
        expect(querySemanticProject).toHaveBeenCalledTimes(1);
        expect(requestTurn).toHaveBeenCalledTimes(2);
    });

    it('enforces per-turn call and total turn budgets', async () => {
        const tooManyCalls = await runApplicationOwnedToolLoop({
            loopId: 'loop-4',
            terminalToolNames: new Set(['setTempo']),
            requestTurn: vi.fn().mockResolvedValue({
                status: 'complete',
                toolCalls: Array.from({ length: 5 }, (_, index) => ({
                    id: `query-${String(index)}`,
                    name: 'project.query',
                    arguments: { type: 'project-summary' },
                })),
            }),
        });
        expect(tooManyCalls).toMatchObject({
            status: 'rejected',
            reason: 'Provider exceeded the application tool-call budget for one turn.',
        });
        expect(querySemanticProject).not.toHaveBeenCalled();

        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: 'revision-2',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 0 },
            items: [],
            nextCursor: null,
            warnings: [],
        });
        let turn = 0;
        const exhausted = await runApplicationOwnedToolLoop({
            loopId: 'loop-5',
            terminalToolNames: new Set(['setTempo']),
            requestTurn: vi.fn(async () => {
                turn += 1;
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        {
                            id: `query-turn-${String(turn)}`,
                            name: 'project.query',
                            arguments: { type: 'project-summary' },
                        },
                    ],
                };
            }),
        });
        expect(exhausted).toMatchObject({
            status: 'rejected',
            reason: 'Provider exhausted the bounded application tool-loop turns.',
            turns: 3,
        });
        expect(querySemanticProject).toHaveBeenCalledTimes(2);
    });

    it('replaces oversized query data with a bounded correlated failure receipt', async () => {
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: 'revision-2',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 1 },
            items: [{ id: 'project-1', kind: 'project', name: 'x'.repeat(20_000) }],
            nextCursor: null,
            warnings: [],
        });
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'query-large', name: 'project.query', arguments: { type: 'project-summary' } }],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-6',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        const receiptContext = requestTurn.mock.calls[1]?.[0].receiptContext as string;
        expect(receiptContext).toContain('query-large');
        expect(receiptContext).toContain('tool-receipt-too-large');
        expect(receiptContext).not.toContain('x'.repeat(1_000));
        expect(result).toMatchObject({ status: 'complete', toolCalls: [] });
    });

    it('honors cancellation before requesting or executing a tool turn', async () => {
        const controller = new AbortController();
        controller.abort();
        const requestTurn = vi.fn();

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-cancelled',
            terminalToolNames: new Set(['setTempo']),
            signal: controller.signal,
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'rejected', reason: 'Application-owned tool loop was cancelled.' });
        expect(requestTurn).not.toHaveBeenCalled();
        expect(querySemanticProject).not.toHaveBeenCalled();

        const midTurnController = new AbortController();
        const midTurnResult = await runApplicationOwnedToolLoop({
            loopId: 'loop-cancelled-mid-turn',
            terminalToolNames: new Set(['setTempo']),
            signal: midTurnController.signal,
            requestTurn: vi.fn(async () => {
                midTurnController.abort();
                return {
                    status: 'complete' as const,
                    toolCalls: [{ name: 'project.query', arguments: { type: 'project-summary' } }],
                };
            }),
        });
        expect(midTurnResult).toMatchObject({
            status: 'rejected',
            reason: 'Application-owned tool loop was cancelled.',
        });
        expect(querySemanticProject).not.toHaveBeenCalled();
    });
});
