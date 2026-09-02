import { describe, expect, it, vi } from 'vitest';

import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { type ToolSchema } from '../../models/ToolDefinitions';
import { AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME } from '../agentToolCatalog';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';

type GetAgentToolCatalogEntries = typeof import('../getAgentToolCatalogEntries').getAgentToolCatalogEntries;

const { mockGetAgentToolCatalogEntries } = vi.hoisted(() => ({
    mockGetAgentToolCatalogEntries: vi.fn<GetAgentToolCatalogEntries>(),
}));

vi.mock('../getAgentToolCatalogEntries', async (importOriginal) => {
    const original = await importOriginal<typeof import('../getAgentToolCatalogEntries')>();
    mockGetAgentToolCatalogEntries.mockImplementation(original.getAgentToolCatalogEntries);
    return { ...original, getAgentToolCatalogEntries: mockGetAgentToolCatalogEntries };
});

type CatalogCursor = {
    schemaVersion: number;
    intentFingerprint: string;
    resultSetFingerprint: string;
    offset: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolSchema(value: unknown): value is ToolSchema {
    if (!isRecord(value) || value.type !== 'function' || !isRecord(value.function)) {
        return false;
    }
    const { function: definition } = value;
    return (
        typeof definition.name === 'string' &&
        typeof definition.description === 'string' &&
        isRecord(definition.parameters) &&
        definition.parameters.type === 'object' &&
        isRecord(definition.parameters.properties) &&
        Array.isArray(definition.parameters.required) &&
        definition.parameters.required.every((name) => typeof name === 'string')
    );
}

function commandIndexCatalogReceipt(value: unknown): { intent: string; nextCursor: string | null } {
    if (
        !isRecord(value) ||
        typeof value.intent !== 'string' ||
        (typeof value.nextCursor !== 'string' && value.nextCursor !== null)
    ) {
        throw new Error('Expected a command-index catalog receipt.');
    }
    return { intent: value.intent, nextCursor: value.nextCursor };
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
        typeof value.intentFingerprint !== 'string' ||
        typeof value.resultSetFingerprint !== 'string' ||
        typeof value.offset !== 'number'
    ) {
        throw new Error('Expected catalog cursor');
    }
    return {
        schemaVersion: value.schemaVersion,
        intentFingerprint: value.intentFingerprint,
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

function parseReceiptContext(receiptContext: string | null): unknown[] {
    if (receiptContext === null) {
        throw new Error('Expected a receipt context.');
    }
    const serializedReceipts = receiptContext.split('\n').at(-1);
    if (serializedReceipts === undefined) {
        throw new Error('Expected serialized receipts.');
    }
    const receiptEnvelope: unknown = JSON.parse(serializedReceipts);
    if (!isRecord(receiptEnvelope) || !Array.isArray(receiptEnvelope.receipts)) {
        throw new Error('Expected a receipt envelope.');
    }
    return receiptEnvelope.receipts;
}

function receiptContextCallIds(receiptContext: string | null): string[] {
    return parseReceiptContext(receiptContext).map((receipt) => {
        if (!isRecord(receipt) || typeof receipt.callId !== 'string') {
            throw new Error('Expected a receipt call identity.');
        }
        return receipt.callId;
    });
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
        if (!isRecord(indexReceipt?.data) || !Array.isArray(indexReceipt.data.items)) {
            throw new Error('Expected command-index receipt data.');
        }
        const indexItem = indexReceipt.data.items[0];
        if (!isRecord(indexItem)) {
            throw new Error('Expected a command-index item.');
        }
        expect(Object.keys(indexItem).sort()).toEqual(['name', 'purpose', 'semanticCategories']);
        expect(indexReceipt.data.items).toEqual([
            {
                name: 'setTempo',
                purpose: expect.any(String),
                semanticCategories: expect.any(Array),
            },
        ]);
        expect(indexReceipt.toolName).toBe(AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME);
        expect(JSON.stringify(indexReceipt)).not.toContain('"parameters"');

        const schemaReceipt = result.receipts[1];
        if (!isRecord(schemaReceipt?.data) || !Array.isArray(schemaReceipt.data.items)) {
            throw new Error('Expected exact command-schema receipt data.');
        }
        const disclosedSchema = schemaReceipt.data.items.find(
            (item): item is ToolSchema => isToolSchema(item) && item.function.name === 'setTempo'
        );
        const canonicalSchema = getExecutableAppActionToolSchemas().find(
            (schema) => schema.function.name === 'setTempo'
        );
        if (disclosedSchema === undefined || canonicalSchema === undefined) {
            throw new Error('Expected the canonical setTempo schema.');
        }
        expect(disclosedSchema).toEqual(canonicalSchema);
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
            warnings: ['Command index page is truncated; continue with the same normalized search intent and cursor.'],
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

    it('keeps maximum multibyte intent cursors within the public limit', async () => {
        const intent = `operation ${'界'.repeat(502)}`;
        const firstPage = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-maximum-multibyte-first',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'maximum-multibyte-first',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent, page: { limit: 1 } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });
        const firstData = firstPage.receipts[0]?.data;
        if (!isRecord(firstData) || typeof firstData.nextCursor !== 'string') {
            throw new Error('Expected a maximum-multibyte command-index cursor.');
        }
        expect(firstData.nextCursor.length).toBeLessThanOrEqual(2048);

        const nextPage = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-maximum-multibyte-next',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'maximum-multibyte-next',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent, page: { cursor: firstData.nextCursor, limit: 1 } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(nextPage).toMatchObject({
            receipts: [{ callId: 'maximum-multibyte-next', status: 'success', data: { page: { offset: 1 } } }],
        });
    });

    it.each([
        { label: '512 astral characters', intent: '𐐀'.repeat(512), status: 'success' },
        { label: '513 astral characters', intent: '𐐀'.repeat(513), status: 'failure' },
    ])('uses JSON Schema Unicode length admission for $label', async ({ intent, status }) => {
        const result = await runApplicationOwnedToolLoop({
            loopId: `intent-command-catalog-unicode-${status}`,
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        { id: `unicode-${status}`, name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME, arguments: { intent } },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(result.receipts[0]).toMatchObject({ callId: `unicode-${status}`, status });
    });

    it.each([
        { label: 'missing command-index intent', name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME, arguments: {} },
        {
            label: 'command-index category',
            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
            arguments: { intent: 'tempo', category: 'command' },
        },
        {
            label: 'command-index names',
            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
            arguments: { intent: 'tempo', names: ['setTempo'] },
        },
        {
            label: 'empty catalog name',
            name: 'agent.catalog.discover',
            arguments: { category: 'command', names: [''] },
        },
        {
            label: 'catalog command-index category',
            name: 'agent.catalog.discover',
            arguments: { category: 'command-index', names: ['setTempo'] },
        },
        {
            label: 'command-index page extras',
            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
            arguments: { intent: 'tempo', page: { limit: 1, unexpected: true } },
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

    it('preserves acronym and Unicode intent before reusing its cursor', async () => {
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
        const firstCatalog = commandIndexCatalogReceipt(firstPage.receipts[0]?.data);

        expect(firstCatalog.intent).toBe('MIDI Café');
        expect(firstPage).toMatchObject({
            receipts: [
                {
                    warnings: [
                        'Command index page is truncated; continue with the same normalized search intent and cursor.',
                    ],
                },
            ],
        });
        if (firstCatalog.nextCursor === null) {
            throw new Error('Expected a command-index cursor.');
        }

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
                                intent: firstCatalog.intent,
                                page: { cursor: firstCatalog.nextCursor },
                            },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(nextPage).toMatchObject({ receipts: [{ status: 'success', data: { intent: 'MIDI Café' } }] });
    });

    it('keeps a schema-admitted ligature intent reusable through the application-owned command index', async () => {
        const intent = `operation ${'ﬀ'.repeat(502)}`;
        const firstPage = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-ligature-first',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'ligature-index-first',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent, page: { limit: 1 } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });
        const firstCatalog = commandIndexCatalogReceipt(firstPage.receipts[0]?.data);
        if (firstCatalog.nextCursor === null) {
            throw new Error('Expected a command-index cursor.');
        }

        const nextPage = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-ligature-next',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'ligature-index-next',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: {
                                intent: firstCatalog.intent,
                                page: { cursor: firstCatalog.nextCursor, limit: 1 },
                            },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(firstCatalog.intent).toBe(intent);
        expect(nextPage).toMatchObject({
            receipts: [{ callId: 'ligature-index-next', status: 'success', data: { intent, page: { offset: 1 } } }],
        });
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
            '',
            '+',
            encodeCursor({ ...cursor, unexpected: true }),
            encodeCursor({ ...cursor, schemaVersion: 2 }),
            encodeCursor({ ...cursor, intentFingerprint: 'different' }),
            encodeCursor({ ...cursor, offset: -1 }),
            encodeCursor({ ...cursor, offset: 1.5 }),
            encodeCursor({ ...cursor, offset: Number.MAX_SAFE_INTEGER + 1 }),
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

    it('normalizes copy inflections before ranking clip commands', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-copy-clip',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'copy-clip-index',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'copies a clip', page: { limit: 1 } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(result).toMatchObject({
            receipts: [{ callId: 'copy-clip-index', status: 'success', data: { items: [{ name: 'duplicateClip' }] } }],
        });
    });

    it('returns purpose-only command matches', async () => {
        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-purpose-only',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn: vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: 'purpose-only-index',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'classify', page: { limit: 1 } },
                        },
                    ],
                })
                .mockResolvedValueOnce({ status: 'complete', toolCalls: [] }),
        });

        expect(result).toMatchObject({
            receipts: [
                { callId: 'purpose-only-index', status: 'success', data: { items: [{ name: 'importStemSet' }] } },
            ],
        });
    });

    it.each(['description', 'parameters'] as const)(
        'rejects %s command schema drift after exact disclosure and before proposal grounding',
        async (drift) => {
            const originalImplementation = mockGetAgentToolCatalogEntries.getMockImplementation();
            if (originalImplementation === undefined) {
                throw new Error('Expected the catalog implementation.');
            }
            let commandSchemaReads = 0;
            mockGetAgentToolCatalogEntries.mockImplementation((input) => {
                const catalog = originalImplementation(input);
                if (input.category !== 'command' || input.names[0] !== 'setTempo') {
                    return catalog;
                }
                if (catalog.category !== 'command') {
                    throw new Error('Expected a command catalog.');
                }
                commandSchemaReads += 1;
                if (commandSchemaReads !== 2) {
                    return catalog;
                }
                const items = catalog.items.map((item) => {
                    if (!isToolSchema(item)) {
                        throw new Error('Expected an exact command tool schema.');
                    }
                    return {
                        ...item,
                        function: {
                            ...item.function,
                            ...(drift === 'description'
                                ? { description: `${item.function.description} changed.` }
                                : {
                                      parameters: {
                                          ...item.function.parameters,
                                          properties: {
                                              ...item.function.parameters.properties,
                                              staleSchema: { type: 'boolean' },
                                          },
                                      },
                                  }),
                        },
                    };
                });
                return {
                    ...catalog,
                    items,
                };
            });

            const result = await runApplicationOwnedToolLoop({
                loopId: `intent-command-catalog-stale-schema-${drift}`,
                terminalToolNames: new Set(['command.batch.propose']),
                requestTurn: vi
                    .fn()
                    .mockResolvedValueOnce({
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'exact-schema',
                                name: 'agent.catalog.discover',
                                arguments: { category: 'command', names: ['setTempo'] },
                            },
                        ],
                    })
                    .mockResolvedValueOnce({
                        status: 'complete',
                        toolCalls: [
                            {
                                id: 'stale-proposal',
                                name: 'command.batch.propose',
                                arguments: { commands: [{ name: 'setTempo', arguments: { bpm: 128 } }] },
                            },
                        ],
                    }),
            });

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Provider command proposal referenced a stale catalog command schema.',
                receipts: [{ callId: 'exact-schema', status: 'success' }],
            });
            expect(result).not.toHaveProperty('toolCalls');
        }
    );

    it('keeps the complete outer receipt identity for command-index success and failure', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'receipt-success',
                        name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                        arguments: { intent: 'tempo' },
                    },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'receipt-failure', name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME, arguments: {} }],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-receipt-identity',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });

        expect(result.receipts).toEqual([
            expect.objectContaining({
                schema: 'sourdaw.application-tool-receipt',
                schemaVersion: 1,
                callId: 'receipt-success',
                toolName: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                turn: 1,
                status: 'success',
                revision: null,
                data: expect.any(Object),
                summary: expect.any(String),
                warnings: expect.any(Array),
                error: null,
            }),
            expect.objectContaining({
                schema: 'sourdaw.application-tool-receipt',
                schemaVersion: 1,
                callId: 'receipt-failure',
                toolName: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                turn: 2,
                status: 'failure',
                revision: null,
                data: null,
                summary: expect.any(String),
                warnings: [],
                error: expect.objectContaining({
                    code: 'invalid-tool-arguments',
                    safeMessage: expect.any(String),
                    retryable: true,
                }),
            }),
        ]);
        expect(result.receipts.map((receipt) => Object.keys(receipt).sort())).toEqual([
            [
                'callId',
                'data',
                'error',
                'revision',
                'schema',
                'schemaVersion',
                'status',
                'summary',
                'toolName',
                'turn',
                'warnings',
            ],
            [
                'callId',
                'data',
                'error',
                'revision',
                'schema',
                'schemaVersion',
                'status',
                'summary',
                'toolName',
                'turn',
                'warnings',
            ],
        ]);
    });

    it('completes two command-index pages, exact schema discovery, and a proposal within the default bounded loop', async () => {
        const requestTurn = vi.fn(async ({ turn, receiptContext }: { turn: number; receiptContext: string | null }) => {
            if (turn === 1) {
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        {
                            id: 'index-page-1',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'tempo operation', page: { limit: 1 } },
                        },
                    ],
                };
            }
            if (turn === 2) {
                const [firstReceipt] = parseReceiptContext(receiptContext);
                if (
                    !isRecord(firstReceipt) ||
                    !isRecord(firstReceipt.data) ||
                    typeof firstReceipt.data.nextCursor !== 'string'
                ) {
                    throw new Error('Expected a next cursor for the first command-index page.');
                }
                const cursor = firstReceipt.data.nextCursor;
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        {
                            id: 'index-page-2',
                            name: AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
                            arguments: { intent: 'tempo operation', page: { cursor, limit: 1 } },
                        },
                    ],
                };
            }
            if (turn === 3) {
                expect(receiptContextCallIds(receiptContext)).toEqual(['index-page-1', 'index-page-2']);
                return {
                    status: 'complete' as const,
                    toolCalls: [
                        {
                            id: 'tempo-schema',
                            name: 'agent.catalog.discover',
                            arguments: { category: 'command', names: ['setTempo'] },
                        },
                    ],
                };
            }
            expect(receiptContextCallIds(receiptContext)).toEqual(['index-page-1', 'index-page-2', 'tempo-schema']);
            return {
                status: 'complete' as const,
                toolCalls: [
                    {
                        id: 'tempo-proposal',
                        name: 'command.batch.propose',
                        arguments: { commands: [{ name: 'setTempo', arguments: { bpm: 128 } }] },
                    },
                ],
            };
        });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'intent-command-catalog-default-four-step',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });

        expect(result).toMatchObject({
            status: 'complete',
            turns: 4,
            receipts: [
                { callId: 'index-page-1', status: 'success' },
                { callId: 'index-page-2', status: 'success' },
                { callId: 'tempo-schema', status: 'success' },
            ],
            toolCalls: [{ id: 'tempo-proposal', name: 'command.batch.propose' }],
        });
    });
});
