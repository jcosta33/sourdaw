import { describe, expect, it } from 'vitest';

import { materializeBatchLocalActionIdentities } from '../materializeBatchLocalActionIdentities';

const busId = 'bus-ai-12345678-1234-4123-8123-123456789abc';

describe('materializeBatchLocalActionIdentities', () => {
    it('adds an application-owned bus ID only after provider actions are validated', () => {
        const result = materializeBatchLocalActionIdentities(
            [
                { type: 'createBus', payload: { name: 'Vocal Plate' } },
                { type: 'addDevice', payload: { trackId: busId, deviceType: 'builtin-reverb' } },
            ],
            [{ actionType: 'createBus', actionOrdinal: 0, busId }]
        );

        expect(result).toEqual({
            status: 'accepted',
            actions: [
                { type: 'createBus', payload: { name: 'Vocal Plate', busId } },
                { type: 'addDevice', payload: { trackId: busId, deviceType: 'builtin-reverb' } },
            ],
        });
    });

    it.each([
        {
            identity: { actionType: 'createBus' as const, actionOrdinal: 0, busId: 'provider-id' },
            reason: 'Invalid or duplicate batch-local action identity',
        },
        {
            identity: { actionType: 'createBus' as const, actionOrdinal: 2, busId },
            reason: 'Batch-local action identity has no validated createBus action',
        },
    ])('rejects identity metadata that cannot correspond to a validated createBus action', ({ identity, reason }) => {
        const result = materializeBatchLocalActionIdentities(
            [{ type: 'createBus', payload: { name: 'Vocal Plate' } }],
            [identity]
        );

        expect(result).toEqual({ status: 'rejected', reason });
    });
});
