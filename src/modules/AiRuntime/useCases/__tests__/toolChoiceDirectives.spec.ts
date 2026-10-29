import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { querySemanticProject } from '#/modules/Project/useCases';

import { type ToolCallResult } from '../../transformers/toolCallParser';
import { AUTO_TOOL_CHOICE } from '../../repositories/cloudLlm/cloudInference/hostedToolPlan';
import {
    type ApplicationOwnedToolLoopInterpretationAdmission,
    runApplicationOwnedToolLoop,
} from '../applicationOwnedToolLoop';

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    querySemanticProject: vi.fn(),
}));

/**
 * The loop-level directive contract every hosted turn relies on: earlier turns stay free to
 * read, discover, or interpret, while only the final allowed turn — including the extra turn a
 * creative interpretation buys — forces the terminal tool set. A provider reply that still
 * carries no tool call on that forced turn is a refusal, not an implicit no-op.
 */
describe('application-owned tool loop directive forcing', () => {
    beforeEach(() => {
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 1, documents: [] },
            revisionToken: 'revision-1',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 0 },
            items: [],
            nextCursor: null,
            warnings: [],
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sends auto on every turn but the final one, and forces the terminal set there', async () => {
        let turn = 0;
        const requestTurn = vi.fn(async (_input: { turn: number; directive: unknown }) => {
            turn += 1;
            if (turn < 4) {
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        { id: `read-${String(turn)}`, name: 'project.query', arguments: { type: 'project-summary' } },
                    ],
                };
            }
            return {
                status: 'complete' as const,
                toolCalls: [{ id: 'final-call', name: 'setTempo', arguments: { bpm: 128 } }],
            };
        });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-directive-final',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'complete', turns: 4 });
        expect(requestTurn).toHaveBeenCalledTimes(4);
        for (const call of requestTurn.mock.calls.slice(0, 3)) {
            expect((call[0] as { directive: unknown }).directive).toEqual(AUTO_TOOL_CHOICE);
        }
        const finalCall = requestTurn.mock.calls[3]?.[0] as { directive: unknown } | undefined;
        expect(finalCall?.directive).toEqual({
            mode: 'required',
            toolNames: ['setTempo'],
        });
    });

    it('forces the terminal set on the creative-interpretation extra turn too', async () => {
        const admitted: ApplicationOwnedToolLoopInterpretationAdmission = {
            status: 'admitted',
            receipt: { data: { chosen: 'a' }, summary: 'Admitted interpretation A.' },
        };
        let turn = 0;
        const requestTurn = vi.fn(async (_input: { turn: number; directive: unknown }) => {
            turn += 1;
            if (turn === 1) {
                return {
                    status: 'complete' as const,
                    toolCalls: [{ id: 'interpretation-1', name: 'selectCreativeInterpretation', arguments: {} }],
                };
            }
            if (turn < 5) {
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        { id: `read-${String(turn)}`, name: 'project.query', arguments: { type: 'project-summary' } },
                    ],
                };
            }
            return {
                status: 'complete' as const,
                toolCalls: [{ id: 'final-call', name: 'setTempo', arguments: { bpm: 128 } }],
            };
        });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-directive-creative-final',
            terminalToolNames: new Set(['setTempo']),
            interpretation: { toolName: 'selectCreativeInterpretation', admit: () => admitted },
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'complete', turns: 5 });
        expect(requestTurn).toHaveBeenCalledTimes(5);
        const firstCall = requestTurn.mock.calls[0]?.[0] as { directive: unknown } | undefined;
        expect(firstCall?.directive).toEqual(AUTO_TOOL_CHOICE);
        for (const call of requestTurn.mock.calls.slice(1, 4)) {
            expect((call[0] as { directive: unknown }).directive).toEqual(AUTO_TOOL_CHOICE);
        }
        const finalCall = requestTurn.mock.calls[4]?.[0] as { directive: unknown } | undefined;
        expect(finalCall?.directive).toEqual({
            mode: 'required',
            toolNames: ['setTempo'],
        });
    });

    it('rejects a forced final turn whose reply carries no tool call, instead of completing it as a no-op', async () => {
        const requestTurn = vi.fn().mockResolvedValue({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-directive-empty-final',
            terminalToolNames: new Set(['setTempo']),
            limits: { maxTurns: 1 },
            requestTurn,
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider returned no tool call on the final application tool-loop turn.',
            turns: 1,
        });
        const onlyCall = requestTurn.mock.calls[0]?.[0] as { directive: unknown } | undefined;
        expect(onlyCall?.directive).toEqual({
            mode: 'required',
            toolNames: ['setTempo'],
        });
    });
});

/** Genuine primary-executor results are correlated only after receipt admission. */
describe('caller-bound single measurement opportunity', () => {
    type MeasurementExecutor = NonNullable<Parameters<typeof runApplicationOwnedToolLoop>[0]['measurement']>['execute'];
    const opportunity = {
        authorityId: 'authority-1',
        callId: 'intake',
        turn: 1,
        revision: 'revision-1',
        required: true,
        available: true,
    };
    const read = (id: string): { id: string; name: string; arguments: Record<string, unknown> } => ({
        id,
        name: 'project.query',
        arguments: { type: 'project-summary' },
    });
    const candidate = {
        id: 'candidate',
        name: 'recipe.expand',
        arguments: { recipeId: 'vocal-warm', targetId: 'track-1' },
    };
    const measure = {
        id: 'measure',
        name: 'analysis.measure',
        arguments: { scope: { kind: 'master' }, range: { startBeat: 0, endBeat: 8 } },
    };
    const terminal = { id: 'terminal', name: 'setTempo', arguments: { bpm: 128 } };

    function executeResult(call: { name: string }, identity: { callId: string; turn: number }) {
        return {
            commands: null,
            receipt: {
                schema: 'sourdaw.application-tool-receipt' as const,
                schemaVersion: 1 as const,
                callId: identity.callId,
                toolName: call.name,
                turn: identity.turn,
                status: 'success' as const,
                revision: 'revision-1',
                data: {},
                summary: 'Measured.',
                warnings: [],
                error: null,
            },
        };
    }

    function runSequence(
        calls: readonly ToolCallResult[][],
        options: {
            execute?: MeasurementExecutor;
            available?: boolean;
            noExecutor?: boolean;
            policy?: typeof opportunity;
            signal?: AbortSignal;
            candidateRevision?: string;
        } = {}
    ) {
        const execute =
            options.execute ?? vi.fn<MeasurementExecutor>(async (call, identity) => executeResult(call, identity));
        const requestTurn = vi.fn(async ({ turn }: { turn: number }) => ({
            status: 'complete' as const,
            toolCalls: calls[turn - 1] ?? [],
        }));
        const result = runApplicationOwnedToolLoop({
            loopId: 'sequence-loop',
            terminalToolNames: new Set(['setTempo', 'selectWorkflowCapability']),
            requestTurn,
            interpretation: {
                toolName: 'selectCreativeInterpretation',
                admit: () => ({ status: 'admitted', receipt: { data: {}, summary: 'Admitted.' } }),
            },
            readMeasurementOpportunity: () =>
                options.policy ?? { ...opportunity, available: options.available ?? true },
            measurement: options.noExecutor
                ? undefined
                : {
                      toolName: 'analysis.measure',
                      companionToolNames: ['analysis.compareReference'],
                      revision: 'revision-1',
                      execute,
                  },
            recipe: {
                toolName: 'recipe.expand',
                revision: 'revision-1',
                execute: (call, identity) => ({
                    ...executeResult(call, { ...identity, turn: identity.turn }),
                    receipt: {
                        ...executeResult(call, identity).receipt,
                        revision: options.candidateRevision ?? 'revision-1',
                    },
                    commands: [
                        {
                            key: 'candidate-command',
                            stepId: 'candidate-step',
                            operation: 'setTempo',
                            arguments: { bpm: 128 },
                            binding: null,
                            dependencyKeys: [],
                            reason: 'Fixture compiler result.',
                            expectedEffect: 'Set tempo.',
                        },
                    ],
                    recipe: { recipeId: 'vocal-warm', title: 'Fixture recipe', targetId: 'track-1' },
                }),
            },
            signal: options.signal,
        });
        return { result, execute, requestTurn };
    }

    const intake = { id: 'intake', name: 'selectCreativeInterpretation', arguments: {} };

    it.each([
        { label: 'zero', calls: [], reason: 'no tool call' },
        { label: 'multiple', calls: [measure, read('also-read')], reason: 'multiple tool calls' },
        { label: 'wrong name', calls: [terminal], reason: 'outside the required' },
    ])('refuses $label before any member executes on the constrained step', async ({ calls, reason }) => {
        const queriesBefore = vi.mocked(querySemanticProject).mock.calls.length;
        const run = runSequence([[intake], [read('read-2')], [candidate], calls]);
        const result = await run.result;
        expect(result).toMatchObject({ status: 'rejected', reason: expect.stringContaining(reason), turns: 4 });
        expect(run.execute).not.toHaveBeenCalled();
        expect(vi.mocked(querySemanticProject).mock.calls.length - queriesBefore).toBe(1);
        expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', {
            mode: 'required',
            toolNames: ['analysis.measure'],
            parallelToolCalls: false,
        });
        expect(result.receipts.map((receipt) => receipt.callId)).toEqual(['intake', 'read-2', 'candidate']);
    });

    it.each(['success', 'refusal', 'throw', 'oversized'] as const)(
        'admits an actual %s attempt before restoring the ordinary final set',
        async (kind) => {
            const execute = vi.fn<MeasurementExecutor>(async (call, identity) => {
                if (kind === 'throw') {
                    throw new Error('Actual executor failed.');
                }
                const result = executeResult(call, identity);
                if (kind === 'refusal') {
                    return {
                        ...result,
                        receipt: {
                            ...result.receipt,
                            status: 'failure' as const,
                            error: {
                                code: 'measurement-budget-exhausted',
                                safeMessage: 'No render budget.',
                                retryable: false,
                            },
                        },
                    };
                }
                if (kind === 'oversized') {
                    return { ...result, receipt: { ...result.receipt, data: { raw: 'x'.repeat(40000) } } };
                }
                return result;
            });
            const run = runSequence([[intake], [read('read-2')], [candidate], [measure], [terminal]], { execute });
            const result = await run.result;
            expect(result).toMatchObject({
                status: 'complete',
                turns: 5,
                retainedCompilations: [expect.objectContaining({ callId: 'candidate' })],
            });
            expect(execute).toHaveBeenCalledOnce();
            expect(run.requestTurn.mock.calls[4]?.[0]).toHaveProperty('directive', {
                mode: 'required',
                toolNames: ['setTempo', 'selectWorkflowCapability'],
            });
            expect(result.receipts.find((receipt) => receipt.callId === 'measure')?.status).toBe(
                kind === 'success' ? 'success' : 'failure'
            );
        }
    );

    it.each(['absent', 'unavailable', 'stale intake'] as const)(
        'keeps a normal final proposal with %s facility or authority',
        async (kind) => {
            const run = runSequence([[intake], [read('read-2')], [candidate], [read('read-4')], [terminal]], {
                noExecutor: kind === 'absent',
                available: kind !== 'unavailable',
                policy: kind === 'stale intake' ? { ...opportunity, callId: 'old-intake' } : undefined,
            });
            expect(await run.result).toMatchObject({ status: 'complete', turns: 5 });
            expect(run.execute).not.toHaveBeenCalled();
            expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', AUTO_TOOL_CHOICE);
        }
    );

    it('does not count a pre-intake measurement as this authority attempt', async () => {
        const run = runSequence([[measure], [{ ...intake, id: 'intake-later' }], [candidate], [], [terminal]], {
            policy: { ...opportunity, callId: 'intake-later', turn: 2 },
        });
        expect(await run.result).toMatchObject({
            status: 'rejected',
            reason: expect.stringContaining('no tool call'),
            turns: 4,
        });
        expect(run.execute).toHaveBeenCalledOnce();
        expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', {
            mode: 'required',
            toolNames: ['analysis.measure'],
            parallelToolCalls: false,
        });
    });

    it.each(['stale', 'pre-intake'] as const)('does not schedule from a %s retained candidate', async (kind) => {
        const calls =
            kind === 'pre-intake'
                ? [[candidate], [{ ...intake, id: 'intake-later' }], [read('read-3')], [read('read-4')], [terminal]]
                : [[intake], [read('read-2')], [candidate], [read('read-4')], [terminal]];
        const run = runSequence(calls, {
            candidateRevision: kind === 'stale' ? 'old-revision' : undefined,
            policy: kind === 'pre-intake' ? { ...opportunity, callId: 'intake-later', turn: 2 } : undefined,
        });
        expect(await run.result).toMatchObject({ status: 'complete', turns: 5 });
        expect(run.execute).not.toHaveBeenCalled();
        expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', AUTO_TOOL_CHOICE);
    });

    it.each(['refusal', 'throw', 'oversized'] as const)(
        'does not reattempt an earlier admitted primary %s after a candidate is prepared',
        async (kind) => {
            const execute = vi.fn<MeasurementExecutor>(async (call, identity) => {
                if (kind === 'throw') {
                    throw new Error('Actual primary executor error.');
                }
                const result = executeResult(call, identity);
                if (kind === 'refusal') {
                    return {
                        ...result,
                        receipt: {
                            ...result.receipt,
                            revision: null,
                            status: 'failure',
                            error: {
                                code: 'measurement-budget-exhausted',
                                safeMessage: 'No render budget.',
                                retryable: false,
                            },
                        },
                    };
                }
                return { ...result, receipt: { ...result.receipt, data: { raw: 'x'.repeat(40000) } } };
            });
            const run = runSequence([[intake], [measure], [candidate], [read('read-4')], [terminal]], { execute });
            const result = await run.result;
            expect(result).toMatchObject({ status: 'complete', turns: 5 });
            expect(execute).toHaveBeenCalledOnce();
            expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', AUTO_TOOL_CHOICE);
            expect(result.receipts.find((receipt) => receipt.callId === 'measure')).toMatchObject({
                status: 'failure',
            });
            if (kind === 'oversized') {
                expect(result.receipts.find((receipt) => receipt.callId === 'measure')?.error?.code).toBe(
                    'tool-receipt-too-large'
                );
            }
            expect(result).toHaveProperty('retainedCompilations', [expect.objectContaining({ callId: 'candidate' })]);
        }
    );

    it.each(['callId', 'toolName', 'turn', 'revision'] as const)(
        'does not accept a primary result with mismatched %s as the attempt witness',
        async (field) => {
            const execute = vi.fn<MeasurementExecutor>(async (call, identity) => {
                const result = executeResult(call, identity);
                if (identity.turn !== 2) {
                    return result;
                }
                const receipt = { ...result.receipt };
                if (field === 'turn') {
                    receipt.turn = 1;
                } else {
                    receipt[field] = 'old-identity';
                }
                return { ...result, receipt };
            });
            const run = runSequence(
                [[intake], [measure], [candidate], [{ ...measure, id: 'current-measure' }], [terminal]],
                { execute }
            );
            expect(await run.result).toMatchObject({ status: 'complete', turns: 5 });
            expect(execute).toHaveBeenCalledTimes(2);
            expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', {
                mode: 'required',
                toolNames: ['analysis.measure'],
                parallelToolCalls: false,
            });
        }
    );

    it('does not admit an executor result after cancellation', async () => {
        const controller = new AbortController();
        const execute = vi.fn<MeasurementExecutor>(async (call, identity) => {
            controller.abort();
            return executeResult(call, identity);
        });
        const run = runSequence([[intake], [measure], [candidate], [read('read-4')], [terminal]], {
            execute,
            signal: controller.signal,
        });
        const result = await run.result;
        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Application-owned tool loop was cancelled.',
            turns: 2,
        });
        expect(result.receipts.map((receipt) => receipt.callId)).toEqual(['intake']);
        expect(run.requestTurn).toHaveBeenCalledTimes(2);
    });

    it('preserves the final workflow selector plus proposal as a multiple-call terminal turn', async () => {
        const requestTurn = vi.fn(async ({ turn }: { turn: number }) => {
            if (turn === 1) {
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        {
                            id: 'catalog',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['setTempo'] },
                        },
                    ],
                };
            }
            if (turn < 4) {
                return { status: 'complete' as const, toolCalls: [read(`read-${String(turn)}`)] };
            }
            return {
                status: 'complete' as const,
                toolCalls: [
                    {
                        id: 'workflow',
                        name: 'selectWorkflowCapability',
                        arguments: { capabilityId: 'stem-import-starting-mix' },
                    },
                    {
                        id: 'proposal',
                        name: 'command.batch.propose',
                        arguments: { commands: [{ name: 'setTempo', arguments: { bpm: 128 } }] },
                    },
                ],
            };
        });
        const result = await runApplicationOwnedToolLoop({
            loopId: 'final-multiple',
            requestTurn,
            terminalToolNames: new Set(['selectWorkflowCapability', 'command.batch.propose']),
        });
        expect(result).toMatchObject({ status: 'complete', turns: 4 });
        if (result.status === 'complete') {
            expect(result.toolCalls.map((call) => call.name)).toEqual([
                'selectWorkflowCapability',
                'command.batch.propose',
            ]);
        }
        expect(requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', {
            mode: 'required',
            toolNames: ['selectWorkflowCapability', 'command.batch.propose'],
        });
    });

    it('does not treat a companion execution or synthetic extra-primary refusal as a primary attempt', async () => {
        const execute = vi.fn<MeasurementExecutor>(async (call, identity) => executeResult(call, identity));
        const companion = { id: 'companion', name: 'analysis.compareReference', arguments: {} };
        const run = runSequence(
            [[intake], [companion, measure], [candidate], [{ ...measure, id: 'actual-primary' }], [terminal]],
            { execute }
        );
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 5 });
        expect(execute.mock.calls.map(([call]) => call.name)).toEqual([
            'analysis.compareReference',
            'analysis.measure',
        ]);
        expect(result.receipts.find((receipt) => receipt.callId === 'measure')).toMatchObject({
            status: 'failure',
            error: { code: 'measure-per-turn-limit' },
        });
        expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', {
            mode: 'required',
            toolNames: ['analysis.measure'],
            parallelToolCalls: false,
        });
    });

    it('keeps an early inert proposal without inventing an attempt', async () => {
        const run = runSequence([[intake], [terminal]]);
        expect(await run.result).toMatchObject({ status: 'complete', turns: 2, retainedCompilations: [] });
        expect(run.execute).not.toHaveBeenCalled();
    });
});
