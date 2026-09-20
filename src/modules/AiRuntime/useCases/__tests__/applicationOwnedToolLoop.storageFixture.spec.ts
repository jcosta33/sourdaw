import { stringify } from 'superjson';
import { afterEach, describe, expect, it, vi } from 'vitest';

const storageKey = 'sourdaw-user-presets';

const malformedPreset = {
    id: 'user-stored-tube-maximal',
    name: '\uD800'.repeat(128),
    category: 'fx' as const,
    subcategory: '\uD800'.repeat(128),
    description: '\uD800'.repeat(1_024),
    trackKind: 'audio' as const,
    devices: Array.from({ length: 8 }, (_, index) => ({
        type: '\uDC00'.repeat(128),
        name: `Device ${String(index)}`,
        parameterValues: {},
    })),
    tags: [...Array.from({ length: 8 }, () => '\uD800'.repeat(128)), 'tube'],
    author: 'User',
    isFactory: true,
};

// The storage adapter decodes SuperJSON into a module-closure cache on its first read.
// Seed before importing the loop so Arrangement owns that cold read of persisted data.
vi.resetModules();
window.localStorage.clear();
window.localStorage.setItem(storageKey, stringify([malformedPreset]));
const { runApplicationOwnedToolLoop } = await import('../applicationOwnedToolLoop');

describe('application-owned tool loop persisted preset discovery', () => {
    afterEach(() => {
        window.localStorage.clear();
        vi.resetModules();
    });

    it('discovers a malformed maximal persisted user preset through the owner and bounded tool receipt', async () => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'discover-malformed-user-preset',
                        name: 'project.discover',
                        arguments: {
                            domain: 'preset',
                            filters: { text: 'tube', stableId: malformedPreset.id },
                            page: { limit: 1 },
                        },
                    },
                ],
            })
            .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });

        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-malformed-user-preset',
            terminalToolNames: new Set(['setTempo']),
            requestTurn,
        });
        const receipt = result.receipts.find((entry) => entry.callId === 'discover-malformed-user-preset');

        expect(new TextEncoder().encode(JSON.stringify(receipt)).byteLength).toBeLessThanOrEqual(16_384);
        expect(receipt).toMatchObject({
            status: 'success',
            error: null,
            data: {
                domain: 'preset',
                items: [
                    {
                        id: malformedPreset.id,
                        evidence: {
                            isFactory: false,
                            tags: expect.arrayContaining(['tube']),
                            metadata: { confidence: 'user-supplied' },
                        },
                    },
                ],
            },
        });
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain(malformedPreset.id);
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('tube');
        expect(requestTurn.mock.calls[1]?.[0].receiptContext).toContain('"isFactory":false');
    });
});
