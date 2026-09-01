import { describe, expect, it, vi } from 'vitest';

import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';

describe('intent command catalog', () => {
    it('finds canonical command names from high-level intent before exact schema disclosure', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'tempo-index',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command-index', intent: 'change the song tempo', page: { limit: 1 } },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'tempo-schema',
                        name: 'agent.catalog.discover',
                        arguments: { category: 'command', names: ['setTempo'] },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });

        expect(result).toMatchObject({
            status: 'complete',
            receipts: [
                {
                    callId: 'tempo-index',
                    status: 'success',
                    data: {
                        schema: 'sourdaw.intent-command-catalog',
                        items: [
                            {
                                name: 'setTempo',
                                purpose: expect.any(String),
                                semanticCategories: expect.arrayContaining(['tempo']),
                            },
                        ],
                        page: { limit: 1, offset: 0 },
                    },
                },
                {
                    callId: 'tempo-schema',
                    status: 'success',
                    data: {
                        items: [
                            {
                                function: expect.objectContaining({
                                    name: 'setTempo',
                                    parameters: expect.any(Object),
                                }),
                            },
                        ],
                    },
                },
            ],
        });

        const indexReceipt = result.receipts[0];
        expect(JSON.stringify(indexReceipt)).not.toContain('"parameters"');
    });

    it('does not disclose invented command names after intent search', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-invented-name',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'invented-schema',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['setImaginaryTempo'] },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(result).toMatchObject({
            receipts: [
                {
                    callId: 'invented-schema',
                    status: 'failure',
                    error: { code: 'invalid-tool-arguments' },
                },
            ],
        });
    });
});
