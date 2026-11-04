import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { querySemanticProject } from '#/modules/Project/useCases';

import { AUTO_TOOL_CHOICE } from '../../repositories/cloudLlm/cloudInference/hostedToolPlan';
import { type ToolCallResult } from '../../transformers/toolCallParser';
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
describe('caller-bound measurement receipt sequence', () => {
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
            measuredPreview: null,
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
        } satisfies Awaited<ReturnType<MeasurementExecutor>>;
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
            workflowIntake?: boolean;
            history?: boolean;
            limits?: Parameters<typeof runApplicationOwnedToolLoop>[0]['limits'];
            readPolicy?: () => typeof opportunity;
            onTurn?: (turn: number) => void;
            terminalToolNames?: readonly string[];
            declineAdmission?: Parameters<typeof runApplicationOwnedToolLoop>[0]['declineAdmission'];
        } = {}
    ) {
        const execute =
            options.execute ?? vi.fn<MeasurementExecutor>(async (call, identity) => executeResult(call, identity));
        const requestTurn = vi.fn(async ({ turn }: { turn: number }) => {
            options.onTurn?.(turn);
            const result: Awaited<ReturnType<Parameters<typeof runApplicationOwnedToolLoop>[0]['requestTurn']>> = {
                status: 'complete',
                toolCalls: calls[turn - 1] ?? [],
            };
            if (options.history) {
                result.providerTurn = {
                    provider: 'openai',
                    assistantItems: [{ type: 'reasoning', id: `reason-${turn}` }],
                };
            }
            return result;
        });
        let measurement: Parameters<typeof runApplicationOwnedToolLoop>[0]['measurement'];
        if (!options.noExecutor) {
            measurement = {
                toolName: 'analysis.measure',
                companionToolNames: ['analysis.compareReference'],
                revision: 'revision-1',
                execute,
            };
        }
        const result = runApplicationOwnedToolLoop({
            loopId: 'sequence-loop',
            terminalToolNames: new Set(options.terminalToolNames ?? ['setTempo', 'selectWorkflowCapability']),
            requestTurn,
            interpretation: {
                toolName: 'selectCreativeInterpretation',
                workflowToolName: options.workflowIntake ? 'selectWorkflowCapability' : undefined,
                admit: () => ({ status: 'admitted', receipt: { data: {}, summary: 'Admitted.' } }),
            },
            readMeasurementOpportunity: () =>
                options.readPolicy?.() ?? options.policy ?? { ...opportunity, available: options.available ?? true },
            measurement,
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
            limits: options.limits,
            declineAdmission: options.declineAdmission,
        });
        return { result, execute, requestTurn };
    }

    const intake = { id: 'intake', name: 'selectCreativeInterpretation', arguments: {} };

    it.each<{ label: string; calls: ToolCallResult[]; measured: boolean }>([
        { label: 'a parallel measure', calls: [measure, { ...measure, id: 'measure-2' }], measured: true },
        { label: 'a measure beside a read', calls: [measure, read('also-read')], measured: true },
        { label: 'no call', calls: [], measured: false },
    ])(
        'keeps an unheld run alive to its final turn when the measurement step returns $label',
        async ({ calls, measured }) => {
            const queriesBefore = vi.mocked(querySemanticProject).mock.calls.length;
            const run = runSequence([[intake], [read('read-2')], [read('read-3')], calls, [terminal]], {
                history: true,
            });
            const result = await run.result;
            expect(result).toMatchObject({ status: 'complete', turns: 5, toolCalls: [terminal] });
            expect(result).not.toHaveProperty('terminalMeasurementSettlement');
            expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', {
                mode: 'required',
                toolNames: ['analysis.measure'],
                parallelToolCalls: false,
            });
            expect(run.requestTurn.mock.calls[4]?.[0]).toMatchObject({
                directive: { mode: 'required', toolNames: expect.arrayContaining(['setTempo']) },
                history: expect.arrayContaining([
                    expect.objectContaining({
                        turn: 4,
                        calls,
                        receipts: calls.map((call) => expect.objectContaining({ callId: call.id })),
                    }),
                ]),
            });
            expect(vi.mocked(querySemanticProject).mock.calls.length - queriesBefore).toBe(2);
            const stepReceipts = result.receipts.filter((entry) => entry.turn === 4);
            const refused = calls.filter((call) => call.name !== 'analysis.measure').map((call) => call.id);
            expect(stepReceipts.some((entry) => refused.includes(entry.callId))).toBe(false);
            if (measured) {
                expect(run.execute).toHaveBeenCalledOnce();
                expect(vi.mocked(run.execute).mock.calls[0]?.[1]).toMatchObject({ callId: 'measure', turn: 4 });
                expect(stepReceipts.find((entry) => entry.callId === 'measure')?.status).toBe('success');
                return;
            }
            expect(run.execute).not.toHaveBeenCalled();
            expect(stepReceipts).toEqual([
                expect.objectContaining({
                    toolName: 'analysis.measure',
                    status: 'failure',
                    revision: null,
                    error: expect.objectContaining({ code: 'measurement-not-requested' }),
                }),
            ]);
        }
    );

    it('releases a proposal sent on the unheld measurement step unverified, with no further turn', async () => {
        const run = runSequence([[intake], [read('read-2')], [read('read-3')], [terminal], []]);
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 4, toolCalls: [terminal] });
        expect(result).not.toHaveProperty('terminalMeasurementSettlement');
        expect(run.requestTurn).toHaveBeenCalledTimes(4);
        expect(run.execute).not.toHaveBeenCalled();
        expect(result.receipts.filter((entry) => entry.turn === 4)).toEqual([
            expect.objectContaining({
                toolName: 'analysis.measure',
                error: expect.objectContaining({ code: 'measurement-not-requested' }),
            }),
        ]);
    });

    it('measures and then releases a proposal sent beside the measure on the unheld step', async () => {
        const run = runSequence([[intake], [read('read-2')], [read('read-3')], [terminal, measure]]);
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 4, toolCalls: [terminal] });
        expect(result).not.toHaveProperty('terminalMeasurementSettlement');
        expect(run.requestTurn).toHaveBeenCalledTimes(4);
        expect(run.execute).toHaveBeenCalledOnce();
        expect(vi.mocked(run.execute).mock.calls[0]?.[1]).toMatchObject({ callId: 'measure', turn: 4 });
        expect(result.receipts.find((entry) => entry.callId === 'measure')?.status).toBe('success');
        expect(result.receipts.some((entry) => entry.callId === 'terminal')).toBe(false);
    });

    it.each([
        { maxTotalCalls: 5, status: 'complete' },
        { maxTotalCalls: 4, status: 'rejected' },
    ])(
        'charges a kept step proposal once beside its measure within $maxTotalCalls calls',
        async ({ maxTotalCalls, status }) => {
            const run = runSequence([[intake], [read('read-2')], [read('read-3')], [terminal, measure], [terminal]], {
                limits: { maxTotalCalls },
            });
            const result = await run.result;
            expect(result.status).toBe(status);
            if (status === 'rejected') {
                expect(result).toMatchObject({
                    turns: 4,
                    reason: expect.stringContaining('total application tool-call budget'),
                });
                expect(run.execute).not.toHaveBeenCalled();
            }
        }
    );

    it.each([
        { label: 'without a measure', calls: [{ ...terminal, id: 'terminal-2', arguments: { bpm: 90 } }] },
        {
            label: 'beside a measure',
            calls: [measure, { ...terminal, id: 'terminal-2', arguments: { bpm: 90 } }],
        },
    ])('keeps the first held proposal over a different one sent on the step $label', async ({ calls }) => {
        const run = runSequence([[intake], [terminal], calls]);
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 3, toolCalls: [terminal] });
        expect(settlementOf(result)).toMatchObject({ deferredCalls: [{ callId: 'terminal', turn: 2 }] });
        expect(result.receipts.some((entry) => entry.callId === 'terminal-2')).toBe(false);
    });

    it('does not keep a step proposal that fails terminal validation', async () => {
        const proposal = (id: string) => ({ id, name: 'command.batch.propose', arguments: { commands: [] } });
        const run = runSequence(
            [
                [intake],
                [read('read-2')],
                [read('read-3')],
                [proposal('proposal-1'), proposal('proposal-2')],
                [terminal],
            ],
            { terminalToolNames: ['setTempo', 'command.batch.propose'] }
        );
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 5, toolCalls: [terminal] });
        expect(run.requestTurn).toHaveBeenCalledTimes(5);
        expect(result.receipts.some((entry) => entry.callId.startsWith('proposal-'))).toBe(false);
    });

    const clarify = {
        id: 'clarify',
        name: 'command.batch.decline',
        arguments: { kind: 'clarify', reason: 'Which key?', questions: ['Which key?'] },
    };
    const declineTerminals = ['setTempo', 'selectWorkflowCapability', 'command.batch.decline'];

    it.each([
        { label: 'alone', calls: [clarify] },
        { label: 'beside a measure', calls: [measure, clarify] },
    ])('completes with a clarify sent on the unheld measurement step $label', async ({ calls }) => {
        const run = runSequence([[intake], [read('read-2')], [read('read-3')], calls, [terminal]], {
            terminalToolNames: declineTerminals,
        });
        const result = await run.result;
        expect(result).toMatchObject({
            status: 'complete',
            turns: 4,
            toolCalls: [clarify],
            decline: { kind: 'clarify', reason: 'Which key?', questions: ['Which key?'] },
            answer: null,
        });
        expect(run.requestTurn).toHaveBeenCalledTimes(4);
        expect(run.execute).not.toHaveBeenCalled();
        expect(result.receipts.some((entry) => entry.turn === 4)).toBe(false);
    });

    it.each([
        { maxTotalCalls: 4, status: 'complete' },
        { maxTotalCalls: 3, status: 'rejected' },
    ])(
        'charges a step decline once and its unrun measure nothing within $maxTotalCalls calls',
        async ({ maxTotalCalls, status }) => {
            const run = runSequence([[intake], [read('read-2')], [read('read-3')], [measure, clarify], [terminal]], {
                terminalToolNames: declineTerminals,
                limits: { maxTotalCalls },
            });
            const result = await run.result;
            expect(result).toMatchObject({ status, turns: 4 });
            if (result.status === 'rejected') {
                expect(result.reason).toContain('total application tool-call budget');
            }
        }
    );

    it('completes with a step decline its admission admits, as on any other turn', async () => {
        const declineAdmission = vi.fn(() => ({ status: 'admitted' as const }));
        const run = runSequence([[intake], [read('read-2')], [read('read-3')], [clarify], [terminal]], {
            terminalToolNames: declineTerminals,
            declineAdmission,
        });
        expect(await run.result).toMatchObject({ status: 'complete', turns: 4, decline: { kind: 'clarify' } });
        expect(declineAdmission).toHaveBeenCalledOnce();
    });

    it('keeps the measurement witness when a step decline is refused, so the final proposal completes unverified', async () => {
        const reason = 'This is work to plan.';
        const run = runSequence([[intake], [read('read-2')], [read('read-3')], [clarify], [terminal]], {
            terminalToolNames: declineTerminals,
            declineAdmission: () => ({ status: 'refused', reason }),
            history: true,
        });
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 5, toolCalls: [terminal], decline: null });
        expect(result).not.toHaveProperty('terminalMeasurementSettlement');
        expect(run.execute).not.toHaveBeenCalled();
        expect(run.requestTurn.mock.calls[4]?.[0]).toMatchObject({
            history: expect.arrayContaining([
                expect.objectContaining({
                    turn: 4,
                    calls: [clarify],
                    receipts: [
                        expect.objectContaining({
                            callId: 'clarify',
                            toolName: 'command.batch.decline',
                            status: 'failure',
                            error: expect.objectContaining({ code: 'decline-not-admitted', safeMessage: reason }),
                        }),
                    ],
                }),
            ]),
        });
        expect(result.receipts.at(-1)).toMatchObject({
            toolName: 'analysis.measure',
            turn: 4,
            error: { code: 'measurement-not-requested' },
        });
        expect(result.receipts.some((entry) => entry.callId === 'clarify')).toBe(false);
    });

    it('runs the step measure beside a refused decline, and a refused decline on the final turn still ends the run', async () => {
        const reason = 'This is work to plan.';
        const run = runSequence(
            [[intake], [read('read-2')], [read('read-3')], [measure, clarify], [{ ...clarify, id: 'clarify-2' }]],
            {
                terminalToolNames: declineTerminals,
                declineAdmission: () => ({ status: 'refused', reason }),
                history: true,
            }
        );
        const result = await run.result;
        expect(result).toMatchObject({
            status: 'rejected',
            turns: 5,
            reason: 'Provider declined a request the application plans, and no turn remained to plan it.',
        });
        expect(run.execute).toHaveBeenCalledOnce();
        expect(result.receipts.filter((entry) => entry.turn === 4)).toEqual([
            expect.objectContaining({ callId: 'measure', status: 'success' }),
        ]);
        expect(run.requestTurn.mock.calls[4]?.[0]).toMatchObject({
            history: expect.arrayContaining([
                expect.objectContaining({
                    turn: 4,
                    calls: [measure, clarify],
                    receipts: [
                        expect.objectContaining({ callId: 'measure', status: 'success' }),
                        expect.objectContaining({
                            callId: 'clarify',
                            error: expect.objectContaining({ code: 'decline-not-admitted', safeMessage: reason }),
                        }),
                    ],
                }),
            ]),
        });
    });

    it('refuses an answer sent on the measurement step, which no answer intake grounds', async () => {
        const answer = {
            id: 'step-answer',
            name: 'answer.respond',
            arguments: { intakeCallId: 'intake', statements: [] },
        };
        const run = runSequence([[intake], [read('read-2')], [read('read-3')], [answer], [terminal]], {
            terminalToolNames: [...declineTerminals, 'answer.respond'],
            history: true,
        });
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 5, toolCalls: [terminal], answer: null });
        expect(result.receipts.some((entry) => entry.callId === 'step-answer')).toBe(false);
        expect(run.requestTurn.mock.calls[4]?.[0]).toMatchObject({
            history: expect.arrayContaining([
                expect.objectContaining({
                    turn: 4,
                    receipts: expect.arrayContaining([
                        expect.objectContaining({
                            callId: 'step-answer',
                            error: expect.objectContaining({ code: 'measurement-step-refused' }),
                        }),
                    ]),
                }),
            ]),
        });
    });

    it.each([
        { label: 'alone', calls: [clarify], measured: false },
        { label: 'beside a measure', calls: [measure, clarify], measured: true },
    ])('releases the held proposal over a decline sent on the step $label', async ({ calls, measured }) => {
        const run = runSequence([[intake], [terminal], calls], { terminalToolNames: declineTerminals });
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 3, toolCalls: [terminal], decline: null });
        expect(result.receipts.some((entry) => entry.callId === 'clarify')).toBe(false);
        expect(settlementOf(result)).toMatchObject({ deferredCalls: [{ callId: 'terminal', turn: 2 }] });
        expect(run.execute).toHaveBeenCalledTimes(measured ? 1 : 0);
    });

    it.each(['before the reply is admitted', 'during the measure'] as const)(
        'does not release a step proposal when cancelled %s',
        async (moment) => {
            const controller = new AbortController();
            const execute = vi.fn<MeasurementExecutor>(async (call, identity) => {
                controller.abort();
                return executeResult(call, identity);
            });
            const run = runSequence(
                [
                    [intake],
                    [read('read-2')],
                    [read('read-3')],
                    moment === 'during the measure' ? [terminal, measure] : [terminal],
                ],
                {
                    execute,
                    signal: controller.signal,
                    onTurn: (turn) => {
                        if (turn === 4 && moment === 'before the reply is admitted') {
                            controller.abort();
                        }
                    },
                }
            );
            expect(await run.result).toMatchObject({
                status: 'rejected',
                turns: 4,
                reason: 'Application-owned tool loop was cancelled.',
            });
        }
    );

    it('answers a parallel measure on the unheld step with the per-turn limit', async () => {
        const run = runSequence([
            [intake],
            [read('read-2')],
            [read('read-3')],
            [measure, { ...measure, id: 'measure-2' }],
            [terminal],
        ]);
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 5 });
        expect(result.receipts.find((entry) => entry.callId === 'measure-2')?.error?.code).toBe(
            'measure-per-turn-limit'
        );
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
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 5 });
        expect(result.receipts.find((entry) => entry.turn === 4)?.error?.code).toBe('measurement-not-requested');
        expect(run.execute).toHaveBeenCalledOnce();
        expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', {
            mode: 'required',
            toolNames: ['analysis.measure'],
            parallelToolCalls: false,
        });
    });

    it.each(['stale', 'pre-intake'] as const)(
        'requires a receipt independently of a %s retained candidate',
        async (kind) => {
            let calls: ToolCallResult[][];
            if (kind === 'pre-intake') {
                calls = [[candidate], [{ ...intake, id: 'intake-later' }], [read('read-3')], [measure], [terminal]];
            } else {
                calls = [[intake], [read('read-2')], [candidate], [measure], [terminal]];
            }
            const run = runSequence(calls, {
                candidateRevision: kind === 'stale' ? 'old-revision' : undefined,
                policy: kind === 'pre-intake' ? { ...opportunity, callId: 'intake-later', turn: 2 } : undefined,
            });
            expect(await run.result).toMatchObject({ status: 'complete', turns: 5 });
            expect(run.execute).toHaveBeenCalledOnce();
            expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', {
                mode: 'required',
                toolNames: ['analysis.measure'],
                parallelToolCalls: false,
            });
        }
    );

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
                const receipt = result.receipt;
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

    it.each([false, true])(
        'holds an early terminal until its actual receipt, workflow intake %s',
        async (workflowIntake) => {
            const selected = workflowIntake ? { ...intake, name: 'selectWorkflowCapability' } : intake;
            const run = runSequence([[selected], [terminal], [measure]], {
                workflowIntake,
                history: true,
                limits: { maxTotalCalls: 3 },
            });
            const result = await run.result;
            expect(result).toMatchObject({
                status: 'complete',
                turns: 3,
                toolCalls: [terminal],
                retainedCompilations: [],
            });
            expect(run.execute).toHaveBeenCalledOnce();
            expect(result.receipts).toContainEqual(
                expect.objectContaining({
                    callId: 'terminal',
                    toolName: 'setTempo',
                    turn: 2,
                    status: 'failure',
                    error: expect.objectContaining({ code: 'measurement-required' }),
                })
            );
            expect(result.receipts).toContainEqual(
                expect.objectContaining({ callId: 'measure', turn: 3, status: 'success' })
            );
            expect(run.requestTurn).toHaveBeenCalledTimes(3);
            expect(run.requestTurn.mock.calls[2]?.[0]).toMatchObject({
                directive: { mode: 'required', toolNames: ['analysis.measure'], parallelToolCalls: false },
                history: expect.arrayContaining([
                    expect.objectContaining({
                        turn: 2,
                        assistantItems: [{ type: 'reasoning', id: 'reason-2' }],
                        calls: [terminal],
                        receipts: [
                            expect.objectContaining({
                                callId: 'terminal',
                                error: expect.objectContaining({ code: 'measurement-required' }),
                            }),
                        ],
                    }),
                ]),
            });
        }
    );

    it('keeps a whole early workflow terminal and answers each original call in native history', async () => {
        const workflow = {
            id: 'workflow-execution',
            name: 'selectWorkflowCapability',
            arguments: { capabilityId: 'stem-import-starting-mix' },
        };
        const run = runSequence([[intake], [workflow, terminal], [measure]], {
            history: true,
            limits: { maxTotalCalls: 4 },
        });
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 3, toolCalls: [workflow, terminal] });
        expect(run.execute).toHaveBeenCalledOnce();
        expect(run.requestTurn.mock.calls[2]?.[0]).toMatchObject({
            history: expect.arrayContaining([
                expect.objectContaining({
                    turn: 2,
                    calls: [workflow, terminal],
                    receipts: [
                        expect.objectContaining({
                            callId: workflow.id,
                            toolName: workflow.name,
                            error: expect.objectContaining({ code: 'measurement-required' }),
                        }),
                        expect.objectContaining({
                            callId: terminal.id,
                            toolName: terminal.name,
                            error: expect.objectContaining({ code: 'measurement-required' }),
                        }),
                    ],
                }),
            ]),
        });
        expect(run.requestTurn).toHaveBeenCalledTimes(3);
    });

    function settlementOf(result: Awaited<ReturnType<typeof runSequence>['result']>): unknown {
        if (result.status !== 'complete' || result.terminalMeasurementSettlement === undefined) {
            throw new Error(`Expected a settled held release, got ${JSON.stringify(result)}`);
        }
        return JSON.parse(result.terminalMeasurementSettlement);
    }

    it.each([
        { label: 'a parallel measure', extra: { ...measure, id: 'measure-2' }, receipt: 'measure-per-turn-limit' },
        { label: 'a read', extra: read('extra-read'), receipt: null },
    ])('admits the first measure and keeps the held proposal beside $label', async ({ extra, receipt }) => {
        const queriesBefore = vi.mocked(querySemanticProject).mock.calls.length;
        const run = runSequence([[intake], [terminal], [measure, extra]]);
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 3, toolCalls: [terminal] });
        expect(run.execute).toHaveBeenCalledOnce();
        expect(vi.mocked(querySemanticProject).mock.calls.length).toBe(queriesBefore);
        expect(result.receipts.some((entry) => entry.callId === extra.id && entry.status === 'success')).toBe(false);
        expect(vi.mocked(run.execute).mock.calls[0]?.[1]).toMatchObject({ callId: 'measure', turn: 3 });
        expect(settlementOf(result)).toMatchObject({ measurement: { callId: 'measure', turn: 3 } });
        expect(result.receipts.find((entry) => entry.callId === 'measure')?.status).toBe('success');
        expect(result.receipts.find((entry) => entry.callId === extra.id)?.error?.code).toBe(receipt ?? undefined);
    });

    it('spends no call budget on calls the held measurement step refuses', async () => {
        const run = runSequence([[intake], [terminal], [measure, read('extra-read')]], {
            limits: { maxTotalCalls: 3 },
        });
        expect(await run.result).toMatchObject({ status: 'complete', turns: 3, toolCalls: [terminal] });
        expect(run.execute).toHaveBeenCalledOnce();
    });

    it.each([
        { label: 'no call', calls: [] },
        { label: 'the held terminal again', calls: [{ ...terminal, id: 'terminal-again' }] },
        { label: 'a read', calls: [read('step-read')] },
    ])('releases the held proposal unverified when the measurement step returns $label', async ({ calls }) => {
        const queriesBefore = vi.mocked(querySemanticProject).mock.calls.length;
        const run = runSequence([[intake], [terminal], calls]);
        const result = await run.result;
        expect(result).toMatchObject({ status: 'complete', turns: 3, toolCalls: [terminal] });
        expect(run.execute).not.toHaveBeenCalled();
        expect(vi.mocked(querySemanticProject).mock.calls.length).toBe(queriesBefore);
        const unmeasured = result.receipts.find((entry) => entry.error?.code === 'measurement-not-requested');
        expect(unmeasured).toMatchObject({ toolName: 'analysis.measure', turn: 3, status: 'failure', revision: null });
        expect(settlementOf(result)).toMatchObject({
            measurement: { callId: unmeasured?.callId, toolName: 'analysis.measure', turn: 3 },
            deferredCalls: [{ callId: 'terminal', turn: 2 }],
        });
        expect(
            result.receipts.some((entry) => entry.toolName === 'analysis.measure' && entry.status === 'success')
        ).toBe(false);
        expect(result.receipts.map((entry) => entry.callId)).toEqual(['intake', 'terminal', unmeasured?.callId]);
    });

    it('does not release a held proposal when cancelled before an unmeasured step is admitted', async () => {
        const controller = new AbortController();
        const run = runSequence([[intake], [terminal], []], {
            signal: controller.signal,
            onTurn: (turn) => {
                if (turn === 3) {
                    controller.abort();
                }
            },
        });
        expect(await run.result).toMatchObject({
            status: 'rejected',
            turns: 3,
            reason: 'Application-owned tool loop was cancelled.',
        });
    });

    it('requires the primary fallback without any retained compilation', async () => {
        const run = runSequence([[intake], [read('read-2')], [read('read-3')], [measure], [terminal]]);
        expect(await run.result).toMatchObject({ status: 'complete', turns: 5, retainedCompilations: [] });
        expect(run.execute).toHaveBeenCalledOnce();
        expect(run.requestTurn.mock.calls[3]?.[0]).toHaveProperty('directive', {
            mode: 'required',
            toolNames: ['analysis.measure'],
            parallelToolCalls: false,
        });
    });

    it('uses the final turn for a held complete proposal without another proposal call', async () => {
        let available = false;
        const run = runSequence([[intake], [terminal], [measure]], {
            limits: { maxTurns: 2 },
            readPolicy: () => ({ ...opportunity, available }),
            onTurn: (turn) => {
                if (turn === 2) {
                    available = true;
                }
            },
        });
        expect(await run.result).toMatchObject({ status: 'complete', turns: 3, toolCalls: [terminal] });
        expect(run.requestTurn).toHaveBeenCalledTimes(3);
    });

    it('refuses a late positive workflow intake that leaves no measure plus terminal budget', async () => {
        const run = runSequence(
            [[read('read-1')], [read('read-2')], [read('read-3')], [{ ...intake, name: 'selectWorkflowCapability' }]],
            {
                workflowIntake: true,
                policy: { ...opportunity, turn: 4 },
            }
        );
        expect(await run.result).toMatchObject({
            status: 'rejected',
            turns: 4,
            reason: expect.stringContaining('insufficient budget'),
        });
        expect(run.execute).not.toHaveBeenCalled();
        expect(run.requestTurn).toHaveBeenCalledTimes(4);
    });

    it.each(['callId', 'toolName', 'turn', 'revision'] as const)(
        'never releases a held proposal after a mismatched required %s',
        async (field) => {
            const execute = vi.fn<MeasurementExecutor>(async (call, identity) => {
                const result = executeResult(call, identity);
                const receipt = result.receipt;
                if (field === 'turn') {
                    receipt.turn = 1;
                } else {
                    receipt[field] = 'foreign';
                }
                return { ...result, receipt };
            });
            const run = runSequence([[intake], [terminal], [measure]], { execute });
            expect(await run.result).toMatchObject({
                status: 'rejected',
                turns: 3,
                reason: expect.stringContaining('did not match'),
            });
            expect(execute).toHaveBeenCalledOnce();
        }
    );

    it('does not release a held proposal when cancelled during the real primary call', async () => {
        const controller = new AbortController();
        const execute = vi.fn<MeasurementExecutor>(async (call, identity) => {
            controller.abort();
            return executeResult(call, identity);
        });
        const run = runSequence([[intake], [terminal], [measure]], { execute, signal: controller.signal });
        const result = await run.result;
        expect(result).toMatchObject({
            status: 'rejected',
            turns: 3,
            reason: 'Application-owned tool loop was cancelled.',
        });
        expect(result.receipts.map((receipt) => receipt.callId)).toEqual(['intake', 'terminal']);
    });

    it('keeps a valid held proposal unverified when the snapshot becomes unavailable', async () => {
        let available = true;
        const execute = vi.fn<MeasurementExecutor>(async (call, identity) => {
            available = false;
            return {
                ...executeResult(call, identity),
                receipt: {
                    ...executeResult(call, identity).receipt,
                    status: 'failure',
                    revision: null,
                    error: { code: 'stale-revision', safeMessage: 'Project moved.', retryable: false },
                },
            };
        });
        const run = runSequence([[intake], [terminal], [measure]], {
            execute,
            readPolicy: () => ({ ...opportunity, available }),
        });
        expect(await run.result).toMatchObject({ status: 'complete', turns: 3, toolCalls: [terminal] });
        expect(execute).toHaveBeenCalledOnce();
    });

    it('bounds the real deferred control receipts before requesting a measurement', async () => {
        const run = runSequence([[intake], [terminal], [measure]], { limits: { maxReceiptBytesPerCall: 260 } });
        expect(await run.result).toMatchObject({
            status: 'rejected',
            reason: expect.stringContaining('receipt budget'),
        });
        expect(run.execute).not.toHaveBeenCalled();
    });
});
