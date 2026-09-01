import { describe, expect, it, vi } from 'vitest';

import { AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME } from '../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';

type CatalogCursor = {
    schemaVersion: number;
    intent: string;
    resultSetFingerprint: string;
    offset: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeCursor(cursor: string): CatalogCursor {
    const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const value: unknown = JSON.parse(
        new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)))
    );
    if (
        !isRecord(value) ||
        typeof value.schemaVersion !== 'number' ||
        typeof value.intent !== 'string' ||
        typeof value.resultSetFingerprint !== 'string' ||
        typeof value.offset !== 'number'
    ) {
        throw new Error('Expected catalog cursor');
    }
    return {
        schemaVersion: value.schemaVersion,
        intent: value.intent,
        resultSetFingerprint: value.resultSetFingerprint,
        offset: value.offset,
    };
}

function encodeCursor(cursor: Record<string, unknown>): string {
    const bytes = new TextEncoder().encode(JSON.stringify(cursor));
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

describe('intent command catalog', () => {
    it('finds canonical command names from high-level intent before exact schema disclosure', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'tempo-index',
                        name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                        arguments: { intent: 'change the song tempo', page: { limit: 1 } },
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

    it('keeps broad intent pagination cursors consumable inside the application-owned loop', async () => {
        const firstPage = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-broad-first-page',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'operation-index-first-page',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'operation', page: { limit: 1 } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });
        const firstReceipt = firstPage.receipts[0];
        const firstCatalog = firstReceipt?.data as { category: string; nextCursor: string | null };

        expect(firstCatalog.category).toBe('command-index');
        expect(firstCatalog.nextCursor).not.toBeNull();
        expect(firstCatalog.nextCursor?.length).toBeLessThanOrEqual(2048);
        expect(firstReceipt).toMatchObject({
            summary: 'command-index: 1 command(s)',
            warnings: ['Command index page is truncated; continue with the same intent and cursor.'],
        });

        const nextPage = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-broad-next-page',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'operation-index-next-page',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: {
                                intent: 'operation',
                                page: { cursor: firstCatalog.nextCursor, limit: 1 },
                            },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(nextPage).toMatchObject({
            receipts: [
                {
                    callId: 'operation-index-next-page',
                    status: 'success',
                    data: { page: { offset: 1 } },
                },
            ],
        });
        expect(firstCatalog).toMatchObject({ items: [{ name: 'importStemSet' }] });
        expect(nextPage.receipts[0]).toMatchObject({ data: { items: [{ name: 'addTrack' }] } });
    });

    it.each([
        { label: 'missing command-index intent', name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME, arguments: {} },
        {
            label: 'command-index names',
            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
            arguments: { intent: 'tempo', names: ['setTempo'] },
        },
        {
            label: 'catalog command-index category',
            name: 'agent.catalog.discover',
            arguments: { category: 'command-index', names: ['setTempo'] },
        },
        {
            label: 'command intent',
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: ['setTempo'], intent: 'tempo' },
        },
        { label: 'missing command names', name: 'agent.catalog.discover', arguments: { category: 'command' } },
    ])('rejects $label at the catalog discovery boundary', async ({ name, arguments: catalogArguments }) => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-cross-category',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [{ id: 'cross-category', name, arguments: catalogArguments }],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(result).toMatchObject({
            receipts: [{ callId: 'cross-category', status: 'failure', error: { code: 'invalid-tool-arguments' } }],
        });
    });

    it('normalizes acronym and Unicode intent before reusing its cursor', async () => {
        const firstPage = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-case-first',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'midi-index-first',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'MIDI Café', page: { limit: 1 } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });
        const firstCatalog = firstPage.receipts[0]?.data as { intent: string; nextCursor: string | null };

        expect(firstCatalog.intent).toBe('midi café');
        expect(firstCatalog.nextCursor).not.toBeNull();

        const nextPage = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-case-next',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'midi-index-next',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: {
                                intent: 'midi café',
                                page: { cursor: firstCatalog.nextCursor },
                            },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(nextPage).toMatchObject({ receipts: [{ status: 'success', data: { intent: 'midi café' } }] });
    });

    it('rejects tampered command-index cursors inside the application-owned loop', async () => {
        const firstPage = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-cursor-source',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'cursor-source',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'operation', page: { limit: 1 } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });
        const catalog = firstPage.receipts[0]?.data as { nextCursor: string | null; page: { total: number } };
        if (catalog.nextCursor === null) {
            throw new Error('Expected a command-index cursor.');
        }
        const cursor = decodeCursor(catalog.nextCursor);
        const tamperedCursors = [
            encodeCursor({ ...cursor, unexpected: true }),
            encodeCursor({ ...cursor, intent: 'tempo' }),
            encodeCursor({ ...cursor, resultSetFingerprint: 'different' }),
            encodeCursor({ ...cursor, offset: catalog.page.total + 1 }),
        ];

        for (const [index, tamperedCursor] of tamperedCursors.entries()) {
            const result = await runApplicationOwnedToolLoop({
                loopId: `intent-command-catalog-cursor-tampered-${String(index)}`,
                terminalToolNames: new Set(['command.batch.propose']),
                requestTurn: vi
                    .fn()
                    .mockResolvedValueOnce({
                        status: 'complete',
                        toolCalls: [
                            {
                                id: `cursor-tampered-${String(index)}`,
                                name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                                arguments: { intent: 'operation', page: { cursor: tamperedCursor, limit: 1 } },
                            },
                        ],
                    })
                    .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
            });

            expect(result).toMatchObject({
                receipts: [
                    {
                        callId: `cursor-tampered-${String(index)}`,
                        status: 'failure',
                        error: { code: 'invalid-tool-arguments' },
                    },
                ],
            });
        }
    });

    it('returns no schema disclosure or warning for an unmatched command-index intent', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-unmatched',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'unmatched-index',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'zzzz' },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(result).toMatchObject({
            receipts: [
                {
                    callId: 'unmatched-index',
                    status: 'success',
                    data: { items: [], nextCursor: null, page: { total: 0 }, truncated: false },
                    warnings: [],
                },
            ],
        });
    });

    it('rejects an index read mixed with a proposal in one tool-loop turn', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-mixed-read-action',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi.fn().mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'mixed-index-read',
                        name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                        arguments: { intent: 'tempo' },
                    },
                    {
                        id: 'mixed-proposal',
                        name: 'command.batch.propose',
                        arguments: { commands: [] },
                    },
                ],
            }),
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Provider mixed project reads with terminal action calls in one turn.',
            receipts: [],
        });
    });

    it('rejects stop-word-only command index searches', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-stop-words',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'stop-word-index',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'the a an' },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(result).toMatchObject({
            receipts: [
                {
                    callId: 'stop-word-index',
                    status: 'failure',
                    error: { code: 'invalid-tool-arguments' },
                },
            ],
        });
    });

    it('ranks destructive marker intent ahead of unrelated marker commands', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-delete-marker',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'delete-marker-index',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'deleting a marker', page: { limit: 1 } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(result).toMatchObject({
            receipts: [
                {
                    callId: 'delete-marker-index',
                    status: 'success',
                    data: { items: [{ name: 'removeMarker' }] },
                },
            ],
        });
    });
});
