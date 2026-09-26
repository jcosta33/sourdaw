import { describe, expect, it, vi } from 'vitest';

import { getAgentBuiltinDeviceFactoryManifest, getPluginById } from '#/modules/Arrangement/useCases';

import { DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT } from '../../models/DeviceManifestPageLimits';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';

const MAX_RECEIPT_BYTES_PER_CALL = 16_384;

type ManifestPageParameter = { id: string; legalValues?: readonly number[] };

type ManifestPageData = {
    devices: ReadonlyArray<{ type: string; version: string; parameters: readonly ManifestPageParameter[] }>;
    page: { limit: number; offset: number; total: number };
    nextCursor: string | null;
    truncated: boolean;
};

function receiptByteLength(receipt: unknown): number {
    return new TextEncoder().encode(JSON.stringify(receipt)).byteLength;
}

async function callDeviceManifest(input: { callId: string; arguments: Record<string, unknown> }) {
    const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({
            status: 'complete',
            toolCalls: [{ id: input.callId, name: 'device.factory-manifest.read', arguments: input.arguments }],
        })
        .mockResolvedValueOnce({ status: 'complete', toolCalls: [] });
    const result = await runApplicationOwnedToolLoop({
        loopId: `loop-${input.callId}`,
        terminalToolNames: new Set(['setTempo']),
        requestTurn,
    });
    const receipt = result.receipts.find((entry) => entry.callId === input.callId);
    if (!receipt) {
        throw new Error(`Missing receipt for callId ${input.callId}`);
    }
    return receipt;
}

describe('device.factory-manifest.read paging', () => {
    it('pages every builtin device type losslessly within the default per-call receipt budget', async () => {
        const descriptors = getAgentBuiltinDeviceFactoryManifest();
        expect(descriptors.length).toBeGreaterThan(0);

        for (const descriptor of descriptors) {
            const collectedIds: string[] = [];
            let cursor: string | undefined;
            let step = 0;
            for (;;) {
                step += 1;
                if (step > 40) {
                    throw new Error(`Paging did not terminate for device type: ${descriptor.type}`);
                }
                const receipt = await callDeviceManifest({
                    callId: `all-${descriptor.type}-${String(step)}`,
                    arguments: { types: [descriptor.type], page: cursor === undefined ? {} : { cursor } },
                });
                expect(receipt.status).toBe('success');
                expect(receiptByteLength(receipt)).toBeLessThanOrEqual(MAX_RECEIPT_BYTES_PER_CALL);
                const data = receipt.data as ManifestPageData;
                const entry = data.devices[0];
                if (!entry) {
                    throw new Error(`Missing paged manifest entry for device type: ${descriptor.type}`);
                }
                expect(entry.parameters.length).toBeLessThanOrEqual(DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT);
                collectedIds.push(...entry.parameters.map((parameter) => parameter.id));
                if (data.nextCursor === null) {
                    expect(data.truncated).toBe(false);
                    break;
                }
                expect(data.truncated).toBe(true);
                cursor = data.nextCursor;
            }
            expect(collectedIds).toEqual(descriptor.parameters.map((parameter) => parameter.id));
        }
    });

    it("returns Crust's oversampling legal set through a second parameters page", async () => {
        const first = await callDeviceManifest({
            callId: 'crust-legal-page-1',
            arguments: { types: ['crust'], page: {} },
        });
        const firstData = first.data as ManifestPageData;
        expect(firstData.nextCursor).not.toBeNull();

        const second = await callDeviceManifest({
            callId: 'crust-legal-page-2',
            arguments: { types: ['crust'], page: { cursor: firstData.nextCursor } },
        });
        const secondData = second.data as ManifestPageData;

        expect(secondData.devices[0]?.parameters).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: 'oversampling', legalValues: [1, 2, 4, 8, 16, 32] })])
        );
    });

    it("returns Dutch Oven's algorithm legal set by walking parameter pages to its offset", async () => {
        let cursor: string | undefined;
        let found: ManifestPageParameter | undefined;
        for (let step = 1; step <= 10 && !found; step += 1) {
            const receipt = await callDeviceManifest({
                callId: `dutch-oven-legal-page-${String(step)}`,
                arguments: { types: ['dutch-oven'], page: cursor === undefined ? {} : { cursor } },
            });
            const data = receipt.data as ManifestPageData;
            found = data.devices[0]?.parameters.find((parameter) => parameter.id === 'algorithm');
            if (data.nextCursor === null) {
                break;
            }
            cursor = data.nextCursor;
        }
        expect(found).toMatchObject({ id: 'algorithm', legalValues: [0, 1, 2, 3, 6] });
    });

    it.each([
        {
            label: 'a page request naming two types',
            arguments: { types: ['crust', 'gluten'], page: {} },
        },
        {
            label: 'a cursor that does not match the strict cursor pattern',
            arguments: { types: ['crust'], page: { cursor: 'not a real cursor!' } },
        },
        {
            label: 'a limit past the published maximum',
            arguments: { types: ['crust'], page: { limit: DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT + 1 } },
        },
    ])('refuses $label as invalid tool arguments', async ({ arguments: callArguments }) => {
        const receipt = await callDeviceManifest({ callId: 'invalid-page-argument', arguments: callArguments });
        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
    });

    it('refuses a cursor obtained for one type when replayed against another', async () => {
        const source = await callDeviceManifest({
            callId: 'cross-type-cursor-source',
            arguments: { types: ['crust'], page: {} },
        });
        const cursor = (source.data as ManifestPageData).nextCursor;
        if (cursor === null) {
            throw new Error('Expected crust to produce a continuation cursor.');
        }

        const replay = await callDeviceManifest({
            callId: 'cross-type-cursor-replay',
            arguments: { types: ['gluten'], page: { cursor } },
        });

        expect(replay).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
    });

    it('refuses a parameter cursor once the descriptor version it was cut from has changed', async () => {
        const descriptor = getPluginById('crust');
        if (!descriptor) {
            throw new Error('Expected the built-in crust descriptor.');
        }
        const originalCharacterTags = descriptor.characterTags;

        const before = await callDeviceManifest({
            callId: 'stale-version-cursor-source',
            arguments: { types: ['crust'], page: {} },
        });
        const cursor = (before.data as ManifestPageData).nextCursor;
        if (cursor === null) {
            throw new Error('Expected crust to produce a continuation cursor.');
        }

        try {
            descriptor.characterTags = ['tube'];
            const after = await callDeviceManifest({
                callId: 'stale-version-cursor-replay',
                arguments: { types: ['crust'], page: { cursor } },
            });
            expect(after).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
        } finally {
            descriptor.characterTags = originalCharacterTags;
        }
    });

    it("keeps an unpaged read byte-for-byte on today's shape when no page argument is present", async () => {
        // builtin-distortion's small descriptor fits the default budget unpaged, so this proves
        // the ordinary read path is untouched by paging rather than exercising the budget refusal
        // every large descriptor already produced before this change.
        const receipt = await callDeviceManifest({
            callId: 'unpaged-shape',
            arguments: { types: ['builtin-distortion'] },
        });

        expect(receipt.status).toBe('success');
        expect(receipt.data).toMatchObject({
            schema: 'sourdaw.agent-device-factory-manifest',
            schemaVersion: 1,
        });
        const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
            typeof value === 'object' && value !== null;
        expect(isPlainRecord(receipt.data) && 'page' in receipt.data).toBe(false);
        expect(isPlainRecord(receipt.data) && 'nextCursor' in receipt.data).toBe(false);
        const devices = (receipt.data as { devices: readonly { type: string; parameters: readonly unknown[] }[] })
            .devices;
        const distortionEntry = devices.find((device) => device.type === 'builtin-distortion');
        expect(distortionEntry?.parameters.length).toBe(
            getAgentBuiltinDeviceFactoryManifest().find((device) => device.type === 'builtin-distortion')?.parameters
                .length
        );
    });
});
