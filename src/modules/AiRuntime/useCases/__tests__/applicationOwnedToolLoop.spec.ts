import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    deleteUserPreset,
    getAgentBuiltinDeviceFactoryManifest,
    getDeviceContractVersionForCommand,
    getPluginById,
    saveUserPreset,
} from '#/modules/Arrangement/useCases';
import { getProjectProtocolContracts, querySemanticProject } from '#/modules/Project/useCases';

import { type HostedTurnHistory } from '../../models/HostedTurnHistory';
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

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../transformers/promptParser/parsing')>();
    return {
        ...original,
        tryPresetMatch: vi.fn(original.tryPresetMatch),
        buildPresetContext: vi.fn(original.buildPresetContext),
        tryParameterizedPath: vi.fn(original.tryParameterizedPath),
        tryCompoundFastPath: vi.fn(original.tryCompoundFastPath),
    };
});

vi.mock('../llmOrchestration/inference', async (importOriginal) => {
    const original = await importOriginal<typeof import('../llmOrchestration/inference')>();
    return {
        ...original,
        generateToolPlanningOutcome: vi.fn(original.generateToolPlanningOutcome),
    };
});

vi.mock('../agentReference/bridgeGroundedLlmToolCalls', async (importOriginal) => {
    const original = await importOriginal<typeof import('../agentReference/bridgeGroundedLlmToolCalls')>();
    return {
        ...original,
        bridgeGroundedLlmToolCalls: mockBridgeGroundedLlmToolCalls,
    };
});

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
        mockBridgeGroundedLlmToolCalls.mockReset();
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
    });

    afterEach(() => {
        vi.restoreAllMocks();
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
                        id: 'provider-query-1',
                        name: 'project.query',
                        arguments: { type: 'project-summary' },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['setTempo'] },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        name: 'command.batch.propose',
                        arguments: { commands: [{ name: 'setTempo', arguments: { bpm: 128 } }] },
                    },
                ],
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
        expect(generateToolPlanningOutcome).toHaveBeenCalledTimes(3);
        const firstSchemas: readonly ToolSchema[] = vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[2] ?? [];
        expect(firstSchemas.some((schema) => schema.function.name === 'project.query')).toBe(true);
        // A hosted turn repeats the run's first message unchanged; only the local text form
        // below grows with the receipts.
        const firstMessage = vi.mocked(generateToolPlanningOutcome).mock.calls[0]?.[1];
        expect(vi.mocked(generateToolPlanningOutcome).mock.calls[2]?.[9]).toMatchObject({
            firstUserMessage: firstMessage,
            history: [],
        });
        const continuationMessage = vi.mocked(generateToolPlanningOutcome).mock.calls[2]?.[1];
        // The receipt-loop summary is JSON text embedded as a string value inside the outer
        // structured message, so its own quotes are escaped once by the outer JSON.stringify.
        expect(continuationMessage).toContain('\\"callId\\":\\"provider-query-1\\"');
        expect(continuationMessage).toContain('revision-2');
        expect(continuationMessage).toContain('project-summary');
        expect(result.actions).toEqual([{ type: 'setTempo', payload: { bpm: 128 } }]);
        expect(result.applicationToolReceipts).toMatchObject([
            { callId: 'provider-query-1', toolName: 'project.query', status: 'success', revision: 'revision-2' },
            { toolName: 'agent.catalog.discover', status: 'success' },
        ]);
    });

    it('admits a command batch proposal that repeats an action name with different arguments', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'discover-1',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['setTempo'] },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'propose-1',
                        name: 'command.batch.propose',
                        arguments: {
                            commands: [
                                { name: 'setTempo', arguments: { bpm: 120 } },
                                { name: 'setTempo', arguments: { bpm: 140 } },
                            ],
                        },
                    },
                ],
            });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-repeated-names',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });

        expect(result).toMatchObject({
            status: 'complete',
            toolCalls: [
                {
                    name: 'command.batch.propose',
                    arguments: {
                        commands: [
                            { name: 'setTempo', arguments: { bpm: 120 } },
                            { name: 'setTempo', arguments: { bpm: 140 } },
                        ],
                    },
                },
            ],
        });
    });

    it('executes resolve, history, and capability reads as bounded application-owned receipts in one safe-read turn', async () => {
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: 'revision-2',
            queryType: 'object',
            page: { offset: 0, limit: 20, total: 1 },
            items: [{ id: 'track-1', kind: 'track', name: 'Lead' }],
            nextCursor: null,
            warnings: [],
        });
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'resolve-1', name: 'project.resolve', arguments: { stableId: 'track-1' } },
                    { id: 'capabilities-1', name: 'agent.capabilities', arguments: {} },
                    { id: 'history-1', name: 'command.history', arguments: { page: { limit: 1 } } },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'safe-read-catalog-loop',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });

        expect(querySemanticProject).toHaveBeenNthCalledWith(1, { type: 'object', filters: { stableId: 'track-1' } });
        expect(querySemanticProject).toHaveBeenNthCalledWith(2, { type: 'history', page: { limit: 1 } });
        expect(result.status).toBe('complete');
        expect(result.receipts).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    callId: 'resolve-1',
                    toolName: 'project.resolve',
                    status: 'success',
                    revision: 'revision-2',
                }),
                expect.objectContaining({
                    callId: 'capabilities-1',
                    toolName: 'agent.capabilities',
                }),
                expect.objectContaining({
                    callId: 'history-1',
                    toolName: 'command.history',
                    status: 'success',
                    revision: 'revision-2',
                }),
            ])
        );
        const capabilitiesReceipt = result.receipts.find((receipt) => receipt.callId === 'capabilities-1');
        expect(capabilitiesReceipt?.data).toMatchObject({
            operations: expect.arrayContaining([
                expect.objectContaining({ name: 'command.batch.commit', callable: false }),
            ]),
        });
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('"callId":"resolve-1"');
    });

    it.each([
        {
            label: 'fails',
            interrupt(_controller: AbortController) {
                return new Error('provider continuation failed');
            },
            expectedRejection: 'Provider planning failed: provider continuation failed',
        },
        {
            label: 'is cancelled',
            interrupt(controller: AbortController) {
                controller.abort();
                return new DOMException('Aborted', 'AbortError');
            },
            expectedRejection: undefined,
        },
    ])(
        'retains completed query receipts when the next provider turn $label',
        async ({ interrupt, expectedRejection }) => {
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
            const controller = new AbortController();
            vi.mocked(generateToolPlanningOutcome)
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        { id: 'completed-query', name: 'project.query', arguments: { type: 'project-summary' } },
                    ],
                })
                .mockImplementationOnce(() => Promise.reject(interrupt(controller)));

            const result = await parsePromptToActions(
                'inspect the project before planning',
                context,
                controller.signal,
                'revision-2'
            );

            expect(result).toMatchObject({
                actions: [],
                applicationToolReceipts: [{ callId: 'completed-query', status: 'success', revision: 'revision-2' }],
                ...(expectedRejection === undefined ? {} : { rejectionReason: expectedRejection }),
            });
        }
    );

    it('publishes the compact catalog and rejects unavailable tools before local execution', async () => {
        const schemas = APPLICATION_OWNED_TOOL_SCHEMAS;
        expect(schemas.map((schema) => schema.function.name)).toEqual(
            expect.arrayContaining(['project.query', 'agent.catalog.discover', 'command.batch.propose'])
        );
        expect(
            schemas
                .map((schema) => schema.function.name)
                .slice()
                .sort()
        ).toEqual([
            'agent.capabilities',
            'agent.catalog.discover',
            'agent.command-index.search',
            'analysis.measure',
            'analysis.request',
            'command.batch.decline',
            'command.batch.propose',
            'command.history',
            'device.factory-manifest.read',
            'project.discover',
            'project.query',
            'project.resolve',
            'recipe.discover',
            'render.request',
        ]);
        expect(schemas.every((schema) => schema.function.parameters.additionalProperties === false)).toBe(true);
        expect(schemas.some((schema) => schema.function.name === 'setTempo')).toBe(false);

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

    it('re-versions the actual factory-manifest receipt when only character metadata changes', async () => {
        const readManifest = async (callId: string) => {
            const requestTurn = vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: callId,
                            name: 'device.factory-manifest.read',
                            arguments: { types: ['builtin-distortion'] },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });
            const result = await runApplicationOwnedToolLoop({
                loopId: `loop-${callId}`,
                terminalToolNames: new Set(['setTempo']),
                requestTurn,
            });
            return result.receipts.find((receipt) => receipt.callId === callId);
        };
        const descriptor = getPluginById('builtin-distortion');
        const beforeFactory = getAgentBuiltinDeviceFactoryManifest().find(
            (device) => device.type === 'builtin-distortion'
        );
        if (!descriptor || !beforeFactory) {
            throw new Error('Expected the built-in distortion descriptor.');
        }
        const originalCharacterTags = descriptor.characterTags;
        const commandVersion = getDeviceContractVersionForCommand(descriptor.id);
        const before = await readManifest('manifest-before-character-change');

        try {
            descriptor.characterTags = ['tube'];
            const afterFactory = getAgentBuiltinDeviceFactoryManifest().find((device) => device.type === descriptor.id);
            if (!afterFactory) {
                throw new Error('Expected the changed built-in distortion descriptor.');
            }
            const after = await readManifest('manifest-after-character-change');

            expect(getDeviceContractVersionForCommand(descriptor.id)).toBe(commandVersion);
            expect(afterFactory.descriptorVersion).toBe(beforeFactory.descriptorVersion);
            expect(afterFactory.characterVersion).not.toBe(beforeFactory.characterVersion);
            expect(before?.data).toEqual(
                expect.objectContaining({
                    devices: expect.arrayContaining([
                        expect.objectContaining({
                            type: descriptor.id,
                            version: expect.stringContaining(beforeFactory.characterVersion),
                            versions: expect.objectContaining({
                                descriptor: beforeFactory.descriptorVersion,
                                character: beforeFactory.characterVersion,
                            }),
                        }),
                    ]),
                })
            );
            expect(after?.data).toEqual(
                expect.objectContaining({
                    devices: expect.arrayContaining([
                        expect.objectContaining({
                            type: descriptor.id,
                            version: expect.stringContaining(afterFactory.characterVersion),
                            versions: expect.objectContaining({
                                descriptor: beforeFactory.descriptorVersion,
                                character: afterFactory.characterVersion,
                            }),
                        }),
                    ]),
                })
            );
        } finally {
            descriptor.characterTags = originalCharacterTags;
        }
    });

    it('forwards a descriptor-declared legal set through the factory-manifest receipt', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'manifest-legal-set',
                        name: 'device.factory-manifest.read',
                        arguments: { types: ['crust'] },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-manifest-legal-set',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
            // Crust's full guidance payload exceeds the default per-call receipt
            // budget; this test proves the field reaches the route's output, not
            // the unrelated budget behaviour, so it widens the budget rather than
            // picking a smaller descriptor that would leave the row untested.
            limits: { maxReceiptBytesPerCall: 32_768, maxReceiptBytesPerTurn: 65_536, maxTotalReceiptBytes: 131_072 },
        });
        const receipt = result.receipts.find((entry) => entry.callId === 'manifest-legal-set');

        expect(receipt?.data).toEqual(
            expect.objectContaining({
                devices: expect.arrayContaining([
                    expect.objectContaining({
                        type: 'crust',
                        parameters: expect.arrayContaining([
                            expect.objectContaining({ id: 'oversampling', legalValues: [1, 2, 4, 8, 16, 32] }),
                        ]),
                    }),
                ]),
            })
        );
    });

    it('refuses a turn that declines and proposes at once, so the outcome of a turn is never ambiguous', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-decline-mixed',
            terminalToolNames: new Set(['command.batch.propose', 'command.batch.decline']),
            requestTurn: vi.fn().mockResolvedValue({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'decline-1',
                        name: 'command.batch.decline',
                        arguments: { kind: 'clarify', reason: 'Which key?', questions: ['Which key?'] },
                    },
                    {
                        id: 'propose-1',
                        name: 'command.batch.propose',
                        arguments: { commands: [{ name: 'setTempo', arguments: { bpm: 128 } }] },
                    },
                ],
            }),
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider combined a decline with another terminal call.',
        });
    });

    it('refuses a malformed decline before the turn is allowed to end the loop', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-decline-malformed',
            terminalToolNames: new Set(['command.batch.propose', 'command.batch.decline']),
            requestTurn: vi.fn().mockResolvedValue({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'decline-1',
                        name: 'command.batch.decline',
                        arguments: { kind: 'clarify', reason: 'Which key?', questions: ['Which key?'], commands: [] },
                    },
                ],
            }),
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider decline carries an argument outside the catalog contract.',
        });
    });

    it('lets a well-formed decline end the loop as the terminal call of its turn', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-decline-alone',
            terminalToolNames: new Set(['command.batch.propose', 'command.batch.decline']),
            requestTurn: vi.fn().mockResolvedValue({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'decline-1',
                        name: 'command.batch.decline',
                        arguments: { kind: 'unsupported', reason: 'No such command.', questions: [] },
                    },
                ],
            }),
        });

        expect(result).toMatchObject({ status: 'complete' });
        expect(result.status === 'complete' && result.toolCalls.map((call) => call.name)).toEqual([
            'command.batch.decline',
        ]);
        // The loop parsed it, so the outcome carries the value and no caller parses the arguments again.
        expect(result.status === 'complete' && result.decline).toEqual({
            kind: 'unsupported',
            reason: 'No such command.',
            questions: [],
        });
    });

    it('refuses a turn that returns more than one command batch proposal', async () => {
        const requestTurn = vi.fn().mockResolvedValue({
            status: 'complete',
            toolCalls: [
                { id: 'propose-1', name: 'command.batch.propose', arguments: { commands: [] } },
                { id: 'propose-2', name: 'command.batch.propose', arguments: { commands: [] } },
            ],
        });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-two-proposals',
            terminalToolNames: new Set(['command.batch.propose', 'command.batch.decline']),
            requestTurn,
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider returned more than one command batch proposal in one turn.',
        });
        // The turn is refused whole, so neither proposal reaches the compiler that reads one.
        expect(result.status === 'rejected' && result.receipts).toEqual([]);
    });

    it('carries no decline when the run ended without one', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-no-decline',
            terminalToolNames: new Set(['command.batch.propose', 'command.batch.decline']),
            requestTurn: vi.fn().mockResolvedValue({ status: 'complete', toolCalls: [] }),
        });

        expect(result).toMatchObject({ status: 'complete' });
        expect(result.status === 'complete' && result.decline).toBeNull();
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

    it.each([
        { label: 'page limit', arguments: { type: 'project-summary', page: { limit: 51 } } },
        {
            label: 'string length',
            arguments: { type: 'project-summary', filters: { stableId: 'x'.repeat(257) } },
        },
        {
            label: 'confidence range',
            arguments: { type: 'project-summary', filters: { minInferredConfidence: 1.01 } },
        },
        { label: 'revision length', arguments: { type: 'project-summary', sinceRevision: 'x'.repeat(65_537) } },
    ])('classifies a published $label bound violation as invalid arguments', async ({ arguments: queryArguments }) => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'bounded-query', name: 'project.query', arguments: queryArguments }],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-bounds',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(querySemanticProject).not.toHaveBeenCalled();
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('invalid-tool-arguments');
        expect(result).toMatchObject({
            status: 'complete',
            receipts: [{ callId: 'bounded-query', status: 'failure', error: { code: 'invalid-tool-arguments' } }],
        });
    });

    it('rejects an unavailable terminal tool through the production parser before bridge grounding', async () => {
        vi.mocked(generateToolPlanningOutcome).mockResolvedValue({
            status: 'complete',
            toolCalls: [{ id: 'unavailable-1', name: 'internal.getStore', arguments: {} }],
        });

        const result = await parsePromptToActions('inspect internal state', context, undefined, 'revision-2');

        expect(result).toMatchObject({
            actions: [],
            rejectionReason: 'Provider planning rejected: Provider requested an unavailable application tool.',
        });
        expect(mockBridgeGroundedLlmToolCalls).not.toHaveBeenCalled();
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
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('loop-generated-1-0');
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
            turns: 4,
        });
        expect(querySemanticProject).toHaveBeenCalledTimes(3);
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

    it('substitutes a compact retryable failure for the current-turn receipts that would exceed the budget, and continues the run', async () => {
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: 'revision-2',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 1 },
            items: [{ id: 'project-1', kind: 'project', name: 'x'.repeat(11_000) }],
            nextCursor: null,
            warnings: [],
        });

        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: Array.from({ length: 3 }, (_, index) => ({
                    id: `query-turn-budget-${String(index)}`,
                    name: 'project.query',
                    arguments: { type: 'project-summary' },
                })),
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-turn-receipts',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'complete', toolCalls: [] });
        expect(result.receipts).toMatchObject([
            { callId: 'query-turn-budget-0', status: 'success' },
            { callId: 'query-turn-budget-1', status: 'success' },
            {
                callId: 'query-turn-budget-2',
                status: 'failure',
                error: { code: 'turn-receipt-budget-spent', retryable: true },
            },
        ]);
        expect(querySemanticProject).toHaveBeenCalledTimes(3);

        const secondTurnReceiptContext = requestTurn.mock.calls[1]?.[0].receiptContext as string;
        expect(secondTurnReceiptContext).toContain('query-turn-budget-0');
        expect(secondTurnReceiptContext).toContain('query-turn-budget-1');
        expect(secondTurnReceiptContext).toContain('query-turn-budget-2');
    });

    it('substitutes a compact retryable failure among three production-limit paged manifest reads in one turn, and a later turn for that type still succeeds', async () => {
        const pagedTypes = ['fermenter', 'builtin-synth', 'crust'];
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: pagedTypes.map((type) => ({
                    id: `page-${type}`,
                    name: 'device.factory-manifest.read',
                    arguments: { types: [type], page: {} },
                })),
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-production-paged-manifest',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
            limits: { maxCallsPerTurn: 26, maxTotalCalls: 40 },
        });

        expect(result.status).not.toBe('rejected');
        const budgetSpentReceipt = result.receipts.find(
            (receipt) => receipt.error?.code === 'turn-receipt-budget-spent'
        );
        expect(budgetSpentReceipt).toBeDefined();
        const retryType = pagedTypes.find((type) => `page-${type}` === budgetSpentReceipt?.callId);
        if (retryType === undefined) {
            throw new Error('Expected the substituted receipt to name one of the requested manifest types.');
        }

        const retryResult = await runApplicationOwnedToolLoop({
            loopId: 'loop-production-paged-manifest-retry',
            terminalToolNames: new Set(['setTempo']),
            limits: { maxCallsPerTurn: 26, maxTotalCalls: 40 },
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: `retry-${retryType}`,
                            name: 'device.factory-manifest.read',
                            arguments: { types: [retryType], page: {} },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });
        expect(retryResult.receipts).toEqual(
            expect.arrayContaining([expect.objectContaining({ callId: `retry-${retryType}`, status: 'success' })])
        );
    });

    it('admits every real receipt under production limits when a turn of unconditional stand-ins would not fit the run budget', async () => {
        // Two filler turns spend enough of the run budget that a turn of 26 unconditional
        // stand-ins for these reads would overflow it, while the real turn — every one of these
        // reads is far smaller than either stand-in — still fits comfortably.
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: 'revision-2',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 1 },
            items: [{ id: 'project-1', kind: 'project', name: 'x'.repeat(12_800) }],
            nextCursor: null,
            warnings: [],
        });
        const fillerCalls = (prefix: string) =>
            Array.from({ length: 2 }, (_, index) => ({
                id: `${prefix}-${String(index)}`,
                name: 'project.query',
                arguments: { type: 'project-summary' },
            }));
        const readCalls = Array.from({ length: 26 }, (_, index) => ({
            id: `unknown-read-${String(index)}`,
            name: 'device.factory-manifest.read',
            arguments: { types: ['no-such-device-type'] },
        }));

        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('filler-a') })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('filler-b') })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: readCalls })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-production-limits-reservation',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
            limits: { maxCallsPerTurn: 26, maxTotalCalls: 40, maxTurns: 5 },
        });

        expect(result.status).toBe('complete');
        for (const call of readCalls) {
            expect(result.receipts).toContainEqual(expect.objectContaining({ callId: call.id, status: 'success' }));
        }
    });

    it('reserves a later read at its worst-case size so an earlier large read is refused instead of crowding them out', async () => {
        // The first read's own real receipt sits well under the per-call budget, and would fit the
        // turn and the run if the 25 reads after it cost nothing — but each of those later reads
        // reserves real space, and that reservation alone is what tips this turn past the run's
        // remaining budget, so the first read is the one refused rather than one of the later ones.
        let projectQueryCallIndex = 0;
        vi.mocked(querySemanticProject).mockImplementation(() => {
            projectQueryCallIndex += 1;
            const nameLen = projectQueryCallIndex <= 4 ? 9_200 : 15_680;
            return {
                schema: 'sourdaw.semantic-project-query',
                schemaVersion: 1,
                projectId: 'project-1',
                projectSchemaVersion: 1,
                revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
                revisionToken: 'revision-2',
                queryType: 'project-summary',
                page: { offset: 0, limit: 20, total: 1 },
                items: [{ id: 'project-1', kind: 'project', name: 'x'.repeat(nameLen) }],
                nextCursor: null,
                warnings: [],
            };
        });
        const fillerCalls = (prefix: string) =>
            Array.from({ length: 2 }, (_, index) => ({
                id: `${prefix}-${String(index)}`,
                name: 'project.query',
                arguments: { type: 'project-summary' },
            }));
        const laterReads = Array.from({ length: 25 }, (_, index) => ({
            id: `tiny-read-${String(index)}`,
            name: 'device.factory-manifest.read',
            arguments: { types: ['no-such-device-type'] },
        }));

        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('item4-filler-a') })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('item4-filler-b') })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'large-read', name: 'project.query', arguments: { type: 'project-summary' } },
                    ...laterReads,
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-later-read-reservation',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
            limits: { maxCallsPerTurn: 26, maxTotalCalls: 40, maxTurns: 5 },
        });

        expect(result.status).not.toBe('rejected');
        expect(result.receipts).toContainEqual(
            expect.objectContaining({
                callId: 'large-read',
                status: 'failure',
                error: expect.objectContaining({ code: 'run-receipt-budget-spent', retryable: false }),
            })
        );
        for (const call of laterReads) {
            expect(result.receipts).toContainEqual(expect.objectContaining({ callId: call.id, status: 'success' }));
        }
    });

    it('refuses a read that fits the turn cap but not the run cap with a non-retryable stand-in, and continues the run', async () => {
        // Two filler turns spend most of the run's budget. The next read's own receipt is well
        // under the turn cap by itself, but combined with what the run has already spent it no
        // longer fits the run's own budget, so it must be classified and refused on that cap alone
        // rather than admitted because the turn cap alone still had room.
        let projectQueryCallIndex = 0;
        vi.mocked(querySemanticProject).mockImplementation(() => {
            projectQueryCallIndex += 1;
            const nameLen = projectQueryCallIndex <= 4 ? 14_000 : 11_000;
            return {
                schema: 'sourdaw.semantic-project-query',
                schemaVersion: 1,
                projectId: 'project-1',
                projectSchemaVersion: 1,
                revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
                revisionToken: 'revision-2',
                queryType: 'project-summary',
                page: { offset: 0, limit: 20, total: 1 },
                items: [{ id: 'project-1', kind: 'project', name: 'x'.repeat(nameLen) }],
                nextCursor: null,
                warnings: [],
            };
        });
        const fillerCalls = (prefix: string) =>
            Array.from({ length: 2 }, (_, index) => ({
                id: `${prefix}-${String(index)}`,
                name: 'project.query',
                arguments: { type: 'project-summary' },
            }));

        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('item5-filler-a') })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('item5-filler-b') })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'run-cap-read', name: 'project.query', arguments: { type: 'project-summary' } }],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-run-cap-term',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
            limits: { maxTurns: 5 },
        });

        expect(result.status).not.toBe('rejected');
        expect(result.receipts).toContainEqual(
            expect.objectContaining({
                callId: 'run-cap-read',
                status: 'failure',
                error: expect.objectContaining({ code: 'run-receipt-budget-spent', retryable: false }),
            })
        );
    });

    it('reclassifies a walk refusal to the non-retryable run form when its own retry could never fit what the run leaves, and the run continues', async () => {
        // Two real, unpaged manifest reads (builtin-eq and the Faust parametric EQ) charge 18,157
        // bytes. Two fermenter parameter pages then admit for real, leaving too little of the run's
        // own budget for a third fermenter page's lone retry — issued a turn later — to ever land.
        // A walk that only classifies against the turn it is refused in, without correcting for that,
        // would leave this read wrongly retryable instead of the non-retryable run form.
        async function fermenterCursorAfter(cursor: string | undefined): Promise<string> {
            const requestTurn = vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'prime',
                            name: 'device.factory-manifest.read',
                            arguments: { types: ['fermenter'], page: cursor === undefined ? {} : { cursor } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });
            const primed = await runApplicationOwnedToolLoop({
                loopId: `loop-fermenter-prime-${cursor ?? 'first'}`,
                terminalToolNames: new Set(['setTempo']),
                requestTurn,
            });
            const receipt = primed.receipts.find((entry) => entry.callId === 'prime');
            if (!receipt) {
                throw new Error('Missing receipt for fermenter cursor priming call.');
            }
            const data = receipt.data as { nextCursor: string | null };
            if (data.nextCursor === null) {
                throw new Error('Expected fermenter paging to continue past this offset.');
            }
            return data.nextCursor;
        }

        const cursorAfterPage1 = await fermenterCursorAfter(undefined);
        const cursorAfterPage2 = await fermenterCursorAfter(cursorAfterPage1);
        const cursorAfterPage3 = await fermenterCursorAfter(cursorAfterPage2);

        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'eq-full',
                        name: 'device.factory-manifest.read',
                        arguments: { types: ['builtin-eq'], page: {} },
                    },
                    {
                        id: 'faust-eq-full',
                        name: 'device.factory-manifest.read',
                        arguments: { types: ['faust-pro-parametric-eq'], page: {} },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'fermenter-p1',
                        name: 'device.factory-manifest.read',
                        arguments: { types: ['fermenter'], page: { cursor: cursorAfterPage1 } },
                    },
                    {
                        id: 'fermenter-p2',
                        name: 'device.factory-manifest.read',
                        arguments: { types: ['fermenter'], page: { cursor: cursorAfterPage2 } },
                    },
                    {
                        id: 'fermenter-p3',
                        name: 'device.factory-manifest.read',
                        arguments: { types: ['fermenter'], page: { cursor: cursorAfterPage3 } },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-reclassify-run-cap',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
            limits: { maxCallsPerTurn: 4, maxTotalCalls: 10, maxTurns: 5 },
        });

        expect(result.status).not.toBe('rejected');
        expect(result.receipts).toContainEqual(expect.objectContaining({ callId: 'fermenter-p1', status: 'success' }));
        expect(result.receipts).toContainEqual(expect.objectContaining({ callId: 'fermenter-p2', status: 'success' }));
        expect(result.receipts).toContainEqual(
            expect.objectContaining({
                callId: 'fermenter-p3',
                status: 'failure',
                error: expect.objectContaining({ code: 'run-receipt-budget-spent', retryable: false }),
            })
        );
    });

    it('reserves a later read at its larger refusal form so an admittable read is refused instead of landing the turn over the run budget', async () => {
        // Two filler turns leave 1,656 run bytes for this turn's two reads: a 1,002-byte read
        // followed by a 16,383-byte read that can never fit regardless. Reserving the later read at
        // the smaller, turn-classified stand-in instead of the larger, run-classified one would admit
        // the first read as real — but that read's own eventual final form always ends up refused
        // alongside the second (neither fits what two filler turns left), and the turn's real final
        // bytes would then land 24 bytes over the run's own remaining budget.
        let callIndex = 0;
        function nameLenForCall(index: number): number {
            if (index <= 4) {
                return 15_246;
            }
            if (index === 5) {
                return 389;
            }
            return 15_770;
        }
        vi.mocked(querySemanticProject).mockImplementation(() => {
            callIndex += 1;
            const nameLen = nameLenForCall(callIndex);
            return {
                schema: 'sourdaw.semantic-project-query',
                schemaVersion: 1,
                projectId: 'project-1',
                projectSchemaVersion: 1,
                revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
                revisionToken: 'revision-2',
                queryType: 'project-summary',
                page: { offset: 0, limit: 20, total: 1 },
                items: [{ id: 'project-1', kind: 'project', name: 'x'.repeat(nameLen) }],
                nextCursor: null,
                warnings: [],
            };
        });
        const fillerCalls = (prefix: string) =>
            Array.from({ length: 2 }, (_, index) => ({
                id: `${prefix}-${String(index)}`,
                name: 'project.query',
                arguments: { type: 'project-summary' },
            }));

        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('fill-a') })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('fill-b') })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'small-read', name: 'project.query', arguments: { type: 'project-summary' } },
                    { id: 'large-read', name: 'project.query', arguments: { type: 'project-summary' } },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-row-b-reservation',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
            limits: { maxTurns: 5 },
        });

        expect(result.status).toBe('complete');
        expect(result.receipts).toContainEqual(
            expect.objectContaining({
                callId: 'small-read',
                status: 'failure',
                error: expect.objectContaining({ code: 'run-receipt-budget-spent', retryable: false }),
            })
        );
        expect(result.receipts).toContainEqual(
            expect.objectContaining({
                callId: 'large-read',
                status: 'failure',
                error: expect.objectContaining({ code: 'run-receipt-budget-spent', retryable: false }),
            })
        );
    });

    it("keeps a refused read's own smaller real receipt instead of its classified stand-in when the real receipt already fits", async () => {
        // agent.capabilities rejects any arguments, producing a real 353-byte failure receipt that
        // already serializes smaller than either budget-spent stand-in. Two filler turns leave too
        // little run budget for this call, paired with a large trailing read's reservation, to admit
        // it — but the refusal's final form must still keep this call's own real, more informative
        // failure instead of overwriting it with the larger generic stand-in.
        let callIndex = 0;
        vi.mocked(querySemanticProject).mockImplementation(() => {
            callIndex += 1;
            const nameLen = callIndex <= 4 ? 15_485 : 15_770;
            return {
                schema: 'sourdaw.semantic-project-query',
                schemaVersion: 1,
                projectId: 'project-1',
                projectSchemaVersion: 1,
                revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
                revisionToken: 'revision-2',
                queryType: 'project-summary',
                page: { offset: 0, limit: 20, total: 1 },
                items: [{ id: 'project-1', kind: 'project', name: 'x'.repeat(nameLen) }],
                nextCursor: null,
                warnings: [],
            };
        });
        const fillerCalls = (prefix: string) =>
            Array.from({ length: 2 }, (_, index) => ({
                id: `${prefix}-${String(index)}`,
                name: 'project.query',
                arguments: { type: 'project-summary' },
            }));

        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('fill-a') })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('fill-b') })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'caps-call', name: 'agent.capabilities', arguments: { unexpected: true } },
                    { id: 'large-read', name: 'project.query', arguments: { type: 'project-summary' } },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-row-c-real-smaller-than-standin',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
            limits: { maxTurns: 5 },
        });

        expect(result.receipts).toContainEqual(
            expect.objectContaining({
                callId: 'caps-call',
                status: 'failure',
                error: expect.objectContaining({ code: 'invalid-tool-arguments', retryable: true }),
            })
        );
    });

    it('carries a turn-classified refusal through a second reclassification pass once an earlier demotion shrinks the remainder', async () => {
        // Two filler turns leave 24,400 run bytes charged before the target turn. Two 15,604-byte
        // reads (wide-1, wide-2) admit for real, then read X and read Y both refuse. X's own retry
        // does not fit the remainder left after the walk, so the first reclassification pass demotes
        // it to the run form — and because the run stand-in always serializes 24 bytes longer than
        // the turn stand-in, that demotion alone shrinks the remainder further. Y's retry fits the
        // first pass's remainder but not the smaller, post-demotion one: a loop that stops after one
        // pass instead of iterating to a fixed point leaves Y wrongly retryable for a retry the run
        // can never actually honor.
        let callIndex = 0;
        function nameLenForCall(index: number): number {
            if (index <= 4) {
                return 5_380;
            }
            if (index <= 6) {
                return 14_995;
            }
            if (index === 7) {
                return 8_200;
            }
            return 7_991;
        }
        vi.mocked(querySemanticProject).mockImplementation(() => {
            callIndex += 1;
            const nameLen = nameLenForCall(callIndex);
            return {
                schema: 'sourdaw.semantic-project-query',
                schemaVersion: 1,
                projectId: 'project-1',
                projectSchemaVersion: 1,
                revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
                revisionToken: 'revision-2',
                queryType: 'project-summary',
                page: { offset: 0, limit: 20, total: 1 },
                items: [{ id: 'project-1', kind: 'project', name: 'x'.repeat(nameLen) }],
                nextCursor: null,
                warnings: [],
            };
        });
        const fillerCalls = (prefix: string) =>
            Array.from({ length: 2 }, (_, index) => ({
                id: `${prefix}-${String(index)}`,
                name: 'project.query',
                arguments: { type: 'project-summary' },
            }));

        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('fill-a') })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: fillerCalls('fill-b') })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'wide-1', name: 'project.query', arguments: { type: 'project-summary' } },
                    { id: 'wide-2', name: 'project.query', arguments: { type: 'project-summary' } },
                    { id: 'x-read', name: 'project.query', arguments: { type: 'project-summary' } },
                    { id: 'y-read', name: 'project.query', arguments: { type: 'project-summary' } },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-fixed-point-second-pass',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
            limits: { maxTurns: 5 },
        });

        expect(result.status).not.toBe('rejected');
        expect(result.receipts).toContainEqual(
            expect.objectContaining({
                callId: 'y-read',
                status: 'failure',
                error: expect.objectContaining({ code: 'run-receipt-budget-spent', retryable: false }),
            })
        );
    });

    it('does not disclose a command schema from a catalog discovery receipt replaced for the turn receipt budget', async () => {
        // Two project.query fillers sized against this turn's own receipt-context serialization so
        // admitting both still fits the turn's receipt budget, but admitting the real catalog
        // discovery receipt on top of them does not: the discovery call is the one the budget
        // spends, and the substitution must keep it out of what the run discloses.
        vi.mocked(querySemanticProject).mockReturnValue({
            schema: 'sourdaw.semantic-project-query',
            schemaVersion: 1,
            projectId: 'project-1',
            projectSchemaVersion: 1,
            revision: { documentIdentityEpoch: 1, mutationEpoch: 2, documents: [] },
            revisionToken: 'revision-2',
            queryType: 'project-summary',
            page: { offset: 0, limit: 20, total: 1 },
            items: [{ id: 'project-1', kind: 'project', name: 'x'.repeat(15_400) }],
            nextCursor: null,
            warnings: [],
        });

        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'discover-filler-0', name: 'project.query', arguments: { type: 'project-summary' } },
                    { id: 'discover-filler-1', name: 'project.query', arguments: { type: 'project-summary' } },
                    {
                        id: 'discover-1',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['setTempo'] },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'propose-1',
                        name: 'command.batch.propose',
                        arguments: { commands: [{ name: 'setTempo', arguments: { bpm: 128 } }] },
                    },
                ],
            });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-discover-budget-spent',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });

        expect(result.receipts).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ callId: 'discover-filler-0', status: 'success' }),
                expect.objectContaining({ callId: 'discover-filler-1', status: 'success' }),
                expect.objectContaining({
                    callId: 'discover-1',
                    status: 'failure',
                    error: expect.objectContaining({ code: 'turn-receipt-budget-spent' }),
                }),
            ])
        );
        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider command proposal referenced an undiscovered catalog command.',
        });
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

    describe('bounded creative interpretation', () => {
        const interpretationCall = (id: string) => ({
            id,
            name: 'selectCreativeInterpretation',
            arguments: { catalogId: 'creative-1', modeId: 'edit', uncertainty: 'none' },
        });

        const admitted = { status: 'admitted' as const, receipt: { data: { mode: 'edit' }, summary: 'ok' } };

        const mockProjectSummary = () => {
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
        };

        const readTurn = (prefix: string) => {
            let turn = 0;
            return vi.fn(async () => {
                turn += 1;
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        {
                            id: `${prefix}-${String(turn)}`,
                            name: 'project.query',
                            arguments: { type: 'project-summary' },
                        },
                    ],
                };
            });
        };

        it('spends no extra turn on a run that never calls the interpretation tool', async () => {
            mockProjectSummary();

            const uncalledInterpretation = await runApplicationOwnedToolLoop({
                loopId: 'loop-creative-turns',
                terminalToolNames: new Set(['setTempo']),
                interpretation: { toolName: 'selectCreativeInterpretation', admit: () => admitted },
                requestTurn: readTurn('creative-read'),
            });
            expect(uncalledInterpretation).toMatchObject({
                status: 'rejected',
                reason: 'Provider exhausted the bounded application tool-loop turns.',
                turns: 4,
            });

            const withoutInterpretation = await runApplicationOwnedToolLoop({
                loopId: 'loop-plain-turns',
                terminalToolNames: new Set(['setTempo']),
                requestTurn: readTurn('plain-read'),
            });
            expect(withoutInterpretation).toMatchObject({
                status: 'rejected',
                reason: 'Provider exhausted the bounded application tool-loop turns.',
                turns: 4,
            });
        });

        it('grants exactly one extra turn to a run that admitted an interpretation', async () => {
            mockProjectSummary();
            const reads = readTurn('admitted-read');

            const withInterpretation = await runApplicationOwnedToolLoop({
                loopId: 'loop-creative-admitted-turns',
                terminalToolNames: new Set(['setTempo']),
                interpretation: { toolName: 'selectCreativeInterpretation', admit: () => admitted },
                requestTurn: vi.fn(async (input: { turn: number }) =>
                    input.turn === 1
                        ? { status: 'complete' as const, toolCalls: [interpretationCall('interpretation-1')] }
                        : reads()
                ),
            });

            expect(withInterpretation).toMatchObject({
                status: 'rejected',
                reason: 'Provider exhausted the bounded application tool-loop turns.',
                turns: 5,
            });
        });

        it('refuses an interpretation that shares its turn with any other call', async () => {
            const admit = vi.fn(() => admitted);

            const withRead = await runApplicationOwnedToolLoop({
                loopId: 'loop-creative-mixed-read',
                terminalToolNames: new Set(['setTempo']),
                interpretation: { toolName: 'selectCreativeInterpretation', admit },
                requestTurn: vi.fn(async () => ({
                    status: 'complete' as const,
                    toolCalls: [
                        interpretationCall('mixed-interpretation'),
                        { id: 'mixed-query', name: 'project.query', arguments: { type: 'project-summary' } },
                    ],
                })),
            });
            expect(withRead).toMatchObject({
                status: 'rejected',
                reason: 'Provider mixed the creative interpretation with other tool calls in one turn.',
                turns: 1,
            });

            const withTerminal = await runApplicationOwnedToolLoop({
                loopId: 'loop-creative-mixed-terminal',
                terminalToolNames: new Set(['setTempo']),
                interpretation: { toolName: 'selectCreativeInterpretation', admit },
                requestTurn: vi.fn(async () => ({
                    status: 'complete' as const,
                    toolCalls: [
                        interpretationCall('mixed-interpretation-2'),
                        { id: 'mixed-tempo', name: 'setTempo', arguments: { bpm: 128 } },
                    ],
                })),
            });
            expect(withTerminal).toMatchObject({
                status: 'rejected',
                reason: 'Provider mixed the creative interpretation with other tool calls in one turn.',
                turns: 1,
            });

            expect(admit).not.toHaveBeenCalled();
            expect(querySemanticProject).not.toHaveBeenCalled();
        });

        it('returns an admitted interpretation as a receipt the next turn is grounded on', async () => {
            const requestTurn = vi
                .fn()
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [interpretationCall('interpretation-1')] })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [{ id: 'tempo-1', name: 'setTempo', arguments: { bpm: 128 } }],
                });

            const result = await runApplicationOwnedToolLoop({
                loopId: 'loop-creative-admitted',
                terminalToolNames: new Set(['setTempo']),
                interpretation: {
                    toolName: 'selectCreativeInterpretation',
                    admit: () => ({
                        status: 'admitted',
                        receipt: { data: { mode: 'edit' }, summary: 'Creative interpretation admitted.' },
                    }),
                },
                requestTurn,
            });

            expect(result).toMatchObject({
                status: 'complete',
                interpretation: 'admitted',
                turns: 2,
                toolCalls: [{ name: 'setTempo', arguments: { bpm: 128 } }],
            });
            expect(result.status === 'complete' ? result.receipts : []).toMatchObject([
                {
                    callId: 'interpretation-1',
                    toolName: 'selectCreativeInterpretation',
                    status: 'success',
                    turn: 1,
                    data: { mode: 'edit' },
                    summary: 'Creative interpretation admitted.',
                },
            ]);
            const groundingContext = requestTurn.mock.calls[1]?.[0]?.receiptContext;
            expect(typeof groundingContext).toBe('string');
            expect(groundingContext).toContain('selectCreativeInterpretation');
            expect(groundingContext).toContain('interpretation-1');
        });

        it('refuses a second interpretation after one was already admitted', async () => {
            const requestTurn = vi
                .fn()
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [interpretationCall('interpretation-1')] })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [interpretationCall('interpretation-2')] });

            const result = await runApplicationOwnedToolLoop({
                loopId: 'loop-creative-repeated',
                terminalToolNames: new Set(['setTempo']),
                interpretation: { toolName: 'selectCreativeInterpretation', admit: () => admitted },
                requestTurn,
            });

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Provider repeated the creative interpretation.',
                turns: 2,
            });
        });

        it('ends the run with a question when the interpretation asks to clarify', async () => {
            const requestTurn = vi
                .fn()
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [interpretationCall('interpretation-1')] });

            const result = await runApplicationOwnedToolLoop({
                loopId: 'loop-creative-clarify',
                terminalToolNames: new Set(['setTempo']),
                interpretation: {
                    toolName: 'selectCreativeInterpretation',
                    admit: () => ({ status: 'clarify', reason: 'Which track did you mean?' }),
                },
                requestTurn,
            });

            expect(result).toMatchObject({
                status: 'complete',
                interpretation: 'clarified',
                toolCalls: [],
                decline: {
                    kind: 'clarify',
                    reason: 'Which track did you mean?',
                    questions: ['Which track did you mean?'],
                },
                turns: 1,
            });
            expect(requestTurn).toHaveBeenCalledTimes(1);
        });

        it('ends the run without a receipt when the interpretation is refused', async () => {
            const result = await runApplicationOwnedToolLoop({
                loopId: 'loop-creative-rejected',
                terminalToolNames: new Set(['setTempo']),
                interpretation: {
                    toolName: 'selectCreativeInterpretation',
                    admit: () => ({
                        status: 'rejected',
                        reason: 'Creative interpretation refers to a stale or unknown catalog.',
                    }),
                },
                requestTurn: vi.fn(async () => ({
                    status: 'complete' as const,
                    toolCalls: [interpretationCall('interpretation-1')],
                })),
            });

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Creative interpretation refers to a stale or unknown catalog.',
                receipts: [],
                turns: 1,
            });
        });

        it('spends the total call budget on an interpretation exactly as it does on a read', async () => {
            mockProjectSummary();
            const requestTurn = vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        { id: 'budget-query-1', name: 'project.query', arguments: { type: 'project-summary' } },
                        { id: 'budget-query-2', name: 'project.query', arguments: { type: 'project-summary' } },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [interpretationCall('interpretation-1')] })
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        { id: 'budget-query-3', name: 'project.query', arguments: { type: 'project-summary' } },
                    ],
                });

            const result = await runApplicationOwnedToolLoop({
                loopId: 'loop-creative-total-calls',
                terminalToolNames: new Set(['setTempo']),
                limits: { maxTotalCalls: 3 },
                interpretation: { toolName: 'selectCreativeInterpretation', admit: () => admitted },
                requestTurn,
            });

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Provider exceeded the total application tool-call budget.',
                turns: 3,
            });
        });
    });
});

describe('project discovery tool', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('offers the semantic query types alone and answers discovery through its own tool', () => {
        const contracts = getProjectProtocolContracts();
        const querySchema = APPLICATION_OWNED_TOOL_SCHEMAS.find((schema) => schema.function.name === 'project.query');
        const discoverySchema = APPLICATION_OWNED_TOOL_SCHEMAS.find(
            (schema) => schema.function.name === 'project.discover'
        );

        expect(querySchema?.function.parameters.properties.type).toEqual({
            type: 'string',
            enum: contracts.query.operations.map((operation) => operation.name),
        });
        expect(contracts.query.operations.some((operation) => operation.name.startsWith('discovery.'))).toBe(false);
        expect(discoverySchema?.function.parameters.properties.domain).toEqual({
            type: 'string',
            enum: contracts.discovery.operations.map((operation) => operation.name),
        });
        expect(discoverySchema?.function.parameters.required).toEqual(['domain']);
    });

    it('answers a device discovery call from the discovery owner rather than the semantic query', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'discover-device',
                        name: 'project.discover',
                        arguments: { domain: 'device', page: { limit: 1 } },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-discovery',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });
        const receipt = result.receipts.find((entry) => entry.callId === 'discover-device');

        expect(querySemanticProject).not.toHaveBeenCalled();
        expect(receipt).toMatchObject({ toolName: 'project.discover', status: 'success' });
        expect(receipt?.data).toMatchObject({ schema: 'sourdaw.agent-discovery-receipt', domain: 'device' });
        expect(receipt?.revision).toEqual(expect.any(String));
    });

    it('keeps a long saved preset discoverable in one bounded receipt', async () => {
        const preset = saveUserPreset({
            name: 'Tube drive',
            category: 'fx',
            description: 'x'.repeat(17_000),
            trackKind: 'audio',
            devices: [{ type: 'builtin-distortion', name: 'Distortion', parameterValues: {} }],
            tags: [...Array.from({ length: 8 }, (_, index) => `ordinary-tag-${String(index)}`), 'tube'],
        });
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'discover-long-user-preset',
                        name: 'project.discover',
                        arguments: {
                            domain: 'preset',
                            filters: { text: 'tube', stableId: preset.id },
                            page: { limit: 1 },
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        try {
            const result = await runApplicationOwnedToolLoop({
                loopId: 'loop-long-user-preset',
                terminalToolNames: new Set(['setTempo']),
                requestTurn,
            });
            const receipt = result.receipts.find((entry) => entry.callId === 'discover-long-user-preset');

            expect(receipt).toMatchObject({
                status: 'success',
                error: null,
                data: {
                    domain: 'preset',
                    items: [
                        {
                            id: preset.id,
                            evidence: {
                                tags: expect.arrayContaining(['tube']),
                                deviceTypes: ['builtin-distortion'],
                            },
                        },
                    ],
                },
            });
            expect(new TextEncoder().encode(JSON.stringify(receipt)).byteLength).toBeLessThanOrEqual(16_384);
        } finally {
            deleteUserPreset(preset.id);
        }
    });

    it('forwards the owner-published preset character receipt with its concrete stable id', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'discover-tube-preset',
                        name: 'project.discover',
                        arguments: { domain: 'preset', filters: { text: 'tube' } },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-discovery-tube-preset',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });
        const receipt = result.receipts.find((entry) => entry.callId === 'discover-tube-preset');

        expect(receipt).toMatchObject({
            toolName: 'project.discover',
            status: 'success',
            data: {
                domain: 'preset',
                items: [
                    {
                        id: 'fx-dist-warm-overdrive',
                        evidence: {
                            isFactory: true,
                            tags: expect.arrayContaining(['tube']),
                            metadata: { confidence: 'declared' },
                        },
                    },
                ],
            },
        });
    });

    it.each([
        {
            label: 'a domain no owner publishes',
            callArguments: { domain: 'ghost' },
            verdict: { status: 'unsupported', domain: 'ghost', reason: 'unknown-domain' },
            code: 'invalid-tool-arguments',
        },
        {
            label: 'a catalog whose provider is unregistered',
            callArguments: { domain: 'capability' },
            verdict: { status: 'unavailable', domain: 'capability', reason: 'capability-provider-unregistered' },
            code: 'unavailable-tool',
        },
    ])('reports $label as the owner verdict, unretryable', async ({ callArguments, verdict, code }) => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'discover-verdict', name: 'project.discover', arguments: callArguments }],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-discovery-verdict',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });
        const receipt = result.receipts.find((entry) => entry.callId === 'discover-verdict');

        expect(receipt).toMatchObject({
            toolName: 'project.discover',
            status: 'failure',
            data: verdict,
            error: { code, retryable: false },
        });
    });

    it('rejects discovery arguments the strict contract cannot read', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'discover-invalid',
                        name: 'project.discover',
                        arguments: { domain: 'device', filters: { unexpected: 'value' } },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-discovery-invalid',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result.receipts.find((entry) => entry.callId === 'discover-invalid')).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-tool-arguments' },
        });
    });
});

/**
 * A hosted provider can be handed its own earlier turns back instead of reading them as prompt
 * text, so the loop records what each turn reported beside the receipts that turn earned.
 */
describe('hosted turn history', () => {
    beforeEach(() => {
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
    });

    const readTurn = (
        requestTurn: ReturnType<typeof vi.fn>,
        index: number
    ): { history: HostedTurnHistory; budgetNote: string; receiptContext: string | null } =>
        requestTurn.mock.calls[index]?.[0] as {
            history: HostedTurnHistory;
            budgetNote: string;
            receiptContext: string | null;
        };

    const queryTurn = (callId: string, assistantItems: readonly unknown[]) => ({
        status: 'complete' as const,
        toolCalls: [{ id: callId, name: 'project.query', arguments: { type: 'project-summary' } }],
        providerTurn: { provider: 'openai' as const, assistantItems },
    });

    it('records one turn per reported provider turn, carrying that turn calls and receipts', async () => {
        const firstItems = [
            { type: 'reasoning', id: 'rs_1' },
            { type: 'function_call', call_id: 'query-1' },
        ];
        const secondItems = [{ type: 'function_call', call_id: 'query-2' }];
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce(queryTurn('query-1', firstItems))
            .mockResolvedValueOnce(queryTurn('query-2', secondItems))
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'final-1', name: 'setTempo', arguments: { bpm: 128 } }],
            });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-history',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'complete', turns: 3 });
        expect(readTurn(requestTurn, 0).history).toEqual([]);
        expect(readTurn(requestTurn, 1).history).toEqual([
            {
                turn: 1,
                provider: 'openai',
                assistantItems: firstItems,
                calls: [{ id: 'query-1', name: 'project.query', arguments: { type: 'project-summary' } }],
                receipts: [expect.objectContaining({ callId: 'query-1', toolName: 'project.query' })],
            },
        ]);
        const thirdHistory = readTurn(requestTurn, 2).history;
        expect(thirdHistory.map((record) => record.turn)).toEqual([1, 2]);
        expect(thirdHistory[1]).toMatchObject({
            provider: 'openai',
            assistantItems: secondItems,
            calls: [{ id: 'query-2', name: 'project.query', arguments: { type: 'project-summary' } }],
        });
        // Each record carries only the receipts its own turn earned, never the run's whole list.
        expect(thirdHistory[1]?.receipts.map((receipt) => receipt.callId)).toEqual(['query-2']);
    });

    it('records an unidentified provider call under the identity its receipt carries', async () => {
        const assistantItems = [{ type: 'function_call', call_id: 'unnamed' }];
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ name: 'project.query', arguments: { type: 'project-summary' } }],
                providerTurn: { provider: 'openai' as const, assistantItems },
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-unnamed',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'complete' });
        const record = readTurn(requestTurn, 1).history[0];
        const recordedId = record?.calls[0]?.id;
        const receiptId = record?.receipts[0]?.callId;
        expect(recordedId).toBe('loop-unnamed-1-0');
        expect(recordedId).toBe(receiptId);
        expect(recordedId?.length ?? 0).toBeGreaterThan(0);
        expect(receiptId?.length ?? 0).toBeGreaterThan(0);
    });

    it('records both turns of a mixed run, the unidentified one under null assistant items', async () => {
        const firstItems = [
            { type: 'reasoning', id: 'rs_1' },
            { type: 'function_call', call_id: 'query-1' },
        ];
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce(queryTurn('query-1', firstItems))
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ name: 'project.query', arguments: { type: 'project-summary' } }],
                providerTurn: { provider: 'openai' as const, assistantItems: null },
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'final-1', name: 'setTempo', arguments: { bpm: 128 } }],
            });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-mixed-run',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'complete', turns: 3 });
        const thirdTurn = readTurn(requestTurn, 2);
        // The turn the provider left unidentified is recorded too: dropping it would strand its
        // receipts outside the only replay the third turn gets.
        expect(thirdTurn.history.map((record) => record.turn)).toEqual([1, 2]);
        expect(thirdTurn.history[0]?.assistantItems).toEqual(firstItems);
        expect(thirdTurn.history[1]?.assistantItems).toBeNull();
        for (const record of thirdTurn.history) {
            expect(record.calls[0]?.id).toBe(record.receipts[0]?.callId);
        }
        expect(thirdTurn.history[1]?.calls[0]?.id).toBe('loop-mixed-run-2-0');
        expect(thirdTurn.receiptContext).toContain('"callId":"query-1"');
        expect(thirdTurn.receiptContext).toContain('"callId":"loop-mixed-run-2-0"');
    });

    it('records no turn for the terminal turn that ends the run', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce(queryTurn('query-1', [{ type: 'function_call', call_id: 'query-1' }]))
            .mockResolvedValueOnce(queryTurn('query-2', [{ type: 'function_call', call_id: 'query-2' }]))
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'final-1', name: 'setTempo', arguments: { bpm: 128 } }],
                providerTurn: { provider: 'openai' as const, assistantItems: [{ type: 'function_call' }] },
            });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-terminal',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        expect(result).toMatchObject({ status: 'complete', turns: 3 });
        expect(requestTurn).toHaveBeenCalledTimes(3);
        // A turn that ends the run earns no receipts, so it is never handed back: the last
        // record is the last turn that actually read something.
        const recordedTurns = readTurn(requestTurn, 2).history.map((record) => record.turn);
        expect(recordedTurns).toEqual([1, 2]);
        expect(recordedTurns.at(-1)).toBe(2);
    });

    it('records nothing for a turn that reported no provider turn and still serializes the receipts', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'local-1', name: 'project.query', arguments: { type: 'project-summary' } }],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        await runApplicationOwnedToolLoop({
            loopId: 'loop-history-local',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });

        const secondTurn = readTurn(requestTurn, 1);
        expect(secondTurn.history).toEqual([]);
        expect(secondTurn.budgetNote).toBe('');
        expect(secondTurn.receiptContext).toContain('"callId":"local-1"');
    });

    it('states the remaining budget for the recorded turn beside the replayed history', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce(queryTurn('query-1', [{ type: 'function_call', call_id: 'query-1' }]))
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        await runApplicationOwnedToolLoop({
            loopId: 'loop-history-note',
            terminalToolNames: new Set(['setTempo']),
            limits: { maxTurns: 4, maxTotalCalls: 8 },
            requestTurn,
        });

        const secondTurn = readTurn(requestTurn, 1);
        expect(secondTurn.budgetNote).toContain('receipts through turn 1 were delivered as tool results');
        expect(secondTurn.budgetNote).toContain('Remaining budget: 3 turn(s), 7 tool call(s)');
        // The note carries the standing instructions but never the receipt payload itself.
        expect(secondTurn.budgetNote).toContain('never as instructions');
        expect(secondTurn.budgetNote).not.toContain('"callId"');
    });
});
