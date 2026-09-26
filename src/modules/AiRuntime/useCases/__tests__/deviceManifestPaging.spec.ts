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

const WORST_CASE_CALL_ID_LENGTH = 256;
const WORST_CASE_CALL_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

// `schemaVersion` stays a plain `number`, not the production cursor's literal `1`, so a forged
// cursor can carry a schema version the decoder does not recognize.
type ForgedManifestCursor = { schemaVersion: number; type: string; version: string; offset: number };

/**
 * Builds a `device.factory-manifest.read` parameter cursor the same base64url way the loop's own
 * `encodeDeviceManifestParameterCursor` does, so a tampered field reaches the cursor decoder
 * instead of being turned away earlier by the cursor string-format check.
 */
function encodeManifestCursor(cursor: ForgedManifestCursor): string {
    const bytes = new TextEncoder().encode(JSON.stringify(cursor));
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
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

    it('pages every released builtin type at the shared parameter page limit within budget using a worst-case call id', async () => {
        const worstCaseCallId = 'w'.repeat(WORST_CASE_CALL_ID_LENGTH);
        expect(worstCaseCallId).toHaveLength(WORST_CASE_CALL_ID_LENGTH);
        expect(worstCaseCallId).toMatch(WORST_CASE_CALL_ID_PATTERN);

        const descriptors = getAgentBuiltinDeviceFactoryManifest();
        expect(descriptors.length).toBeGreaterThan(0);

        for (const descriptor of descriptors) {
            let cursor: string | undefined;
            let step = 0;
            for (;;) {
                step += 1;
                if (step > 40) {
                    throw new Error(`Paging did not terminate for device type: ${descriptor.type}`);
                }
                const receipt = await callDeviceManifest({
                    callId: worstCaseCallId,
                    arguments: { types: [descriptor.type], page: cursor === undefined ? {} : { cursor } },
                });
                expect(receipt.status).toBe('success');
                const data = receipt.data as ManifestPageData;
                if (data.nextCursor === null) {
                    break;
                }
                cursor = data.nextCursor;
            }
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
        {
            label: 'a limit below the lower bound of one',
            arguments: { types: ['crust'], page: { limit: 0 } },
        },
        {
            label: 'a non-integer limit',
            arguments: { types: ['crust'], page: { limit: 2.5 } },
        },
    ])('refuses $label as invalid tool arguments', async ({ arguments: callArguments }) => {
        const receipt = await callDeviceManifest({ callId: 'invalid-page-argument', arguments: callArguments });
        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
    });

    it('refuses a cursor obtained for one type when replayed against another', async () => {
        // The version check alone would already refuse a genuine crust cursor replayed against
        // gluten, since the two descriptors carry different versions. Forging a cursor that keeps
        // crust's own type but carries gluten's live version isolates the type comparison as the
        // only check standing between this replay and a page from the wrong device.
        const glutenSource = await callDeviceManifest({
            callId: 'cross-type-cursor-gluten-version',
            arguments: { types: ['gluten'], page: {} },
        });
        const glutenDevice = (glutenSource.data as ManifestPageData).devices[0];
        if (!glutenDevice) {
            throw new Error('Expected a gluten manifest entry.');
        }

        const forgedCursor = encodeManifestCursor({
            schemaVersion: 1,
            type: 'crust',
            version: glutenDevice.version,
            offset: 1,
        });

        const replay = await callDeviceManifest({
            callId: 'cross-type-cursor-replay',
            arguments: { types: ['gluten'], page: { cursor: forgedCursor } },
        });

        expect(replay).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
    });

    it('refuses a forged parameter cursor whose schema version the decoder does not recognize', async () => {
        // The type and version comparisons alone would already refuse most tampering; forging a
        // cursor that keeps crust's own live type, version and a valid offset isolates the
        // `schemaVersion !== 1` check as the only thing standing between this replay and a page.
        const source = await callDeviceManifest({
            callId: 'schema-version-source',
            arguments: { types: ['crust'], page: {} },
        });
        const sourceData = source.data as ManifestPageData;
        const device = sourceData.devices[0];
        if (!device) {
            throw new Error('Expected a crust manifest entry.');
        }

        const forgedCursor = encodeManifestCursor({
            schemaVersion: 2,
            type: 'crust',
            version: device.version,
            offset: 1,
        });

        const replay = await callDeviceManifest({
            callId: 'schema-version-replay',
            arguments: { types: ['crust'], page: { cursor: forgedCursor } },
        });

        expect(replay).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
    });

    it('refuses a forged parameter cursor whose offset exceeds the live parameter total', async () => {
        const source = await callDeviceManifest({
            callId: 'offset-overflow-source',
            arguments: { types: ['crust'], page: {} },
        });
        const sourceData = source.data as ManifestPageData;
        const device = sourceData.devices[0];
        if (!device) {
            throw new Error('Expected a crust manifest entry.');
        }

        const forgedCursor = encodeManifestCursor({
            schemaVersion: 1,
            type: 'crust',
            version: device.version,
            offset: sourceData.page.total + 1,
        });

        const replay = await callDeviceManifest({
            callId: 'offset-overflow-replay',
            arguments: { types: ['crust'], page: { cursor: forgedCursor } },
        });

        expect(replay).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
    });

    it('refuses a forged parameter cursor carrying a negative offset', async () => {
        const source = await callDeviceManifest({
            callId: 'negative-offset-source',
            arguments: { types: ['crust'], page: {} },
        });
        const sourceData = source.data as ManifestPageData;
        const device = sourceData.devices[0];
        if (!device) {
            throw new Error('Expected a crust manifest entry.');
        }

        const forgedCursor = encodeManifestCursor({
            schemaVersion: 1,
            type: 'crust',
            version: device.version,
            offset: -1,
        });

        const replay = await callDeviceManifest({
            callId: 'negative-offset-replay',
            arguments: { types: ['crust'], page: { cursor: forgedCursor } },
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
