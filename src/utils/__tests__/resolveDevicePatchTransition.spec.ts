import { describe, expect, it } from 'vitest';

import { resolveDevicePatchTransition } from '../resolveDevicePatchTransition';

const missingChunk = { version: 1, data: { instrumentId: 'violin-1' } };
const metadata = { field: 'disclosureTier', allowedValues: ['basic', 'expert'], missingChunk };
const staccato = { version: 1, data: { instrumentId: 'violin-1', articulation: 'staccato' } };
const expertDefault = { version: 1, data: { ...missingChunk.data, disclosureTier: 'expert' } };
const expertStaccato = { version: 1, data: { ...staccato.data, disclosureTier: 'expert' } };

function capture(deviceState: { version: number; data: Record<string, string> } | null, gain: number | null = null) {
    return { deviceState, parameterValues: { gain } };
}

describe('resolveDevicePatchTransition', () => {
    it('retains a later tier when Undo restores initial absence and Redo starts from the resulting witness', () => {
        const undo = resolveDevicePatchTransition(capture(expertStaccato), capture(staccato), capture(null), metadata);
        expect(undo).toEqual({ expected: capture(expertStaccato), next: capture(expertDefault) });
        expect(
            resolveDevicePatchTransition(capture(expertDefault), capture(null), capture(staccato), metadata)
        ).toEqual({
            expected: capture(expertDefault),
            next: capture(expertStaccato),
        });
        expect(resolveDevicePatchTransition(capture(staccato), capture(staccato), capture(null), metadata)).toEqual({
            expected: capture(staccato),
            next: capture(null),
        });
    });

    it('carries a later removal of the tier without materializing absent identity', () => {
        expect(
            resolveDevicePatchTransition(capture(null), capture(expertDefault), capture(expertStaccato), metadata)
        ).toEqual({
            expected: capture(null),
            next: capture(staccato),
        });
    });

    it('rejects versions, raw state, invalid tiers, and numeric fields outside the admitted source', () => {
        for (const divergent of [
            capture({ ...expertStaccato, version: 2 }),
            capture({ ...expertStaccato, data: { ...expertStaccato.data, other: 'peer' } }),
            capture({ ...expertStaccato, data: { ...expertStaccato.data, disclosureTier: 'invalid' } }),
            capture(expertStaccato, 0.4),
        ]) {
            expect(resolveDevicePatchTransition(divergent, capture(staccato), capture(null), metadata)).toBeNull();
        }
        expect(
            resolveDevicePatchTransition(capture(missingChunk), capture(null), capture(staccato), metadata)
        ).toBeNull();
    });
});
