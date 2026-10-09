import { describe, expect, it, vi } from 'vitest';

import { getAgentBuiltinDeviceFactoryManifest } from '#/modules/Arrangement/useCases';

import { DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT } from '../../models/DeviceManifestPageLimits';
import { runApplicationOwnedToolLoop } from '../applicationOwnedToolLoop';

const MAX_RECEIPT_BYTES_PER_CALL = 16_384;
const WORST_CASE_CALL_ID = 'w'.repeat(256);
const SELECTION_CALL_ID = `${'w'.repeat(248)}-select`;
if (SELECTION_CALL_ID.length > 256) {
    throw new Error('Selection call id must stay inside the loop call-id bound');
}

type IndexEntry = { id: string; name: string };

type IndexData = {
    schema: string;
    schemaVersion: number;
    devices: ReadonlyArray<{
        type: string;
        name: string;
        version: string;
        parameterCount: number;
        parameterIndex: readonly IndexEntry[];
    }>;
};

type SelectionData = {
    schema: string;
    schemaVersion: number;
    devices: ReadonlyArray<{ type: string; parameters: ReadonlyArray<Record<string, unknown>> }>;
};

function receiptByteLength(receipt: unknown): number {
    return new TextEncoder().encode(JSON.stringify(receipt)).byteLength;
}

function descriptorFor(type: string) {
    const descriptor = getAgentBuiltinDeviceFactoryManifest().find((candidate) => candidate.type === type);
    if (!descriptor) {
        throw new Error(`Expected a released builtin descriptor for ${type}`);
    }
    return descriptor;
}

/**
 * Runs one tool loop under the default production limits with a scripted
 * provider: turn 1 reads the compact parameter index, turn 2 reads an explicit
 * parameter selection, turn 3 plans nothing and ends the run.
 */
async function runIndexThenSelection(input: { type: string; parameterIds: readonly string[] }) {
    let callOrdinal = 0;
    const scriptedCalls = [
        {
            id: WORST_CASE_CALL_ID,
            name: 'device.factory-manifest.read',
            arguments: { types: [input.type], page: { index: true } },
        },
        {
            id: SELECTION_CALL_ID,
            name: 'device.factory-manifest.read',
            arguments: { types: [input.type], parameterIds: [...input.parameterIds] },
        },
    ];
    const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({ status: 'complete', toolCalls: [scriptedCalls[0]] })
        .mockResolvedValueOnce({ status: 'complete', toolCalls: [scriptedCalls[1]] })
        .mockResolvedValue({ status: 'complete', toolCalls: [] });
    const result = await runApplicationOwnedToolLoop({
        loopId: 'loop-large-device-parameter-reads',
        terminalToolNames: new Set(['command.batch.propose']),
        requestTurn: (input_) => {
            callOrdinal += 1;
            return requestTurn(input_);
        },
    });
    const indexReceipt = result.receipts.find((receipt) => receipt.callId === WORST_CASE_CALL_ID);
    if (!indexReceipt) {
        throw new Error('Missing index receipt');
    }
    const selectionReceipt = result.receipts.find((receipt) => receipt.callId === SELECTION_CALL_ID);
    if (!selectionReceipt) {
        throw new Error('Missing selection receipt');
    }
    return { result, indexReceipt, selectionReceipt, callOrdinal };
}

describe('device.factory-manifest.read parameter index and selection (#4797)', () => {
    it('reads a large device needed parameters within one default-limit tool-loop run', async () => {
        const descriptor = descriptorFor('fermenter');
        const neededIds = ['oscLevel', 'filterCutoff', 'ampRelease'];

        const { result, indexReceipt, selectionReceipt, callOrdinal } = await runIndexThenSelection({
            type: descriptor.type,
            parameterIds: neededIds,
        });

        expect(callOrdinal).toBe(3);
        expect(result).toMatchObject({ status: 'complete', turns: 3 });

        expect(indexReceipt.status).toBe('success');
        expect(receiptByteLength(indexReceipt)).toBeLessThanOrEqual(MAX_RECEIPT_BYTES_PER_CALL);
        const indexData = indexReceipt.data as IndexData;
        const indexed = indexData.devices[0];
        expect(indexed?.type).toBe(descriptor.type);
        expect(indexed?.parameterCount).toBe(descriptor.parameters.length);
        expect(indexed?.parameterIndex).toEqual(
            descriptor.parameters.map((parameter) => ({ id: parameter.id, name: parameter.name }))
        );

        expect(selectionReceipt.status).toBe('success');
        expect(receiptByteLength(selectionReceipt)).toBeLessThanOrEqual(MAX_RECEIPT_BYTES_PER_CALL);
        const selectionData = selectionReceipt.data as SelectionData;
        expect(selectionData.devices[0]?.type).toBe(descriptor.type);
        expect(selectionData.devices[0]?.parameters).toEqual(
            descriptor.parameters.filter((parameter) => neededIds.includes(parameter.id))
        );
    });

    it('returns the full compact index within one receipt for every released builtin type', async () => {
        const descriptors = getAgentBuiltinDeviceFactoryManifest();
        expect(descriptors.length).toBeGreaterThan(0);

        for (const descriptor of descriptors) {
            const requestTurn = vi
                .fn()
                .mockResolvedValueOnce({
                    status: 'complete',
                    toolCalls: [
                        {
                            id: WORST_CASE_CALL_ID,
                            name: 'device.factory-manifest.read',
                            arguments: { types: [descriptor.type], page: { index: true } },
                        },
                    ],
                })
                .mockResolvedValue({ status: 'complete', toolCalls: [] });
            const result = await runApplicationOwnedToolLoop({
                loopId: `loop-index-${descriptor.type}`,
                terminalToolNames: new Set(['command.batch.propose']),
                requestTurn,
            });
            const receipt = result.receipts.find((entry) => entry.callId === WORST_CASE_CALL_ID);
            if (!receipt) {
                throw new Error(`Missing index receipt for ${descriptor.type}`);
            }
            expect(receipt.status).toBe('success');
            expect(receiptByteLength(receipt)).toBeLessThanOrEqual(MAX_RECEIPT_BYTES_PER_CALL);
            const data = receipt.data as IndexData;
            expect(data.devices[0]?.parameterIndex).toEqual(
                descriptor.parameters.map((parameter) => ({ id: parameter.id, name: parameter.name }))
            );
        }
    });

    it('returns a full page-sized selection within one receipt at the parameter bound', async () => {
        const descriptor = descriptorFor('fermenter');
        const selectedIds = descriptor.parameters
            .slice(0, DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT)
            .map((parameter) => parameter.id);
        expect(selectedIds).toHaveLength(DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT);

        const { selectionReceipt } = await runIndexThenSelection({
            type: descriptor.type,
            parameterIds: selectedIds,
        });

        expect(selectionReceipt.status).toBe('success');
        expect(receiptByteLength(selectionReceipt)).toBeLessThanOrEqual(MAX_RECEIPT_BYTES_PER_CALL);
        const selectionData = selectionReceipt.data as SelectionData;
        expect(selectionData.devices[0]?.parameters).toEqual(
            descriptor.parameters.filter((parameter) => selectedIds.includes(parameter.id))
        );
    });

    it.each([
        {
            label: 'a parameter selection naming two types',
            arguments: { types: ['fermenter', 'crust'], parameterIds: ['oscLevel'] },
        },
        {
            label: 'a parameter selection combined with a page',
            arguments: { types: ['fermenter'], parameterIds: ['oscLevel'], page: {} },
        },
        {
            label: 'an empty parameter selection',
            arguments: { types: ['fermenter'], parameterIds: [] },
        },
        {
            label: 'a parameter selection past the published maximum',
            arguments: {
                types: ['fermenter'],
                parameterIds: descriptorFor('fermenter')
                    .parameters.slice(0, DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT + 1)
                    .map((parameter) => parameter.id),
            },
        },
        {
            label: 'a parameter selection with a repeated id',
            arguments: { types: ['fermenter'], parameterIds: ['oscLevel', 'oscLevel'] },
        },
        {
            label: 'a parameter selection naming an id the descriptor does not declare',
            arguments: { types: ['fermenter'], parameterIds: ['not-a-fermenter-parameter'] },
        },
        {
            label: 'a parameter selection with a string where the id array belongs',
            arguments: { types: ['fermenter'], parameterIds: 'oscLevel' },
        },
        {
            label: 'an index page combined with a cursor',
            arguments: { types: ['fermenter'], page: { index: true, cursor: 'Y3Vyc29y' } },
        },
        {
            label: 'an index page combined with a limit',
            arguments: { types: ['fermenter'], page: { index: true, limit: 2 } },
        },
        {
            label: 'an index page that is not exactly true',
            arguments: { types: ['fermenter'], page: { index: false } },
        },
    ])('refuses $label as invalid tool arguments', async ({ arguments: callArguments }) => {
        const requestTurn = vi
            .fn()
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'invalid-selection-argument',
                        name: 'device.factory-manifest.read',
                        arguments: callArguments,
                    },
                ],
            })
            .mockResolvedValue({ status: 'complete', toolCalls: [] });
        const result = await runApplicationOwnedToolLoop({
            loopId: 'loop-invalid-selection',
            terminalToolNames: new Set(['command.batch.propose']),
            requestTurn,
        });
        const receipt = result.receipts.find((entry) => entry.callId === 'invalid-selection-argument');
        if (!receipt) {
            throw new Error('Missing refusal receipt');
        }
        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
    });
});
