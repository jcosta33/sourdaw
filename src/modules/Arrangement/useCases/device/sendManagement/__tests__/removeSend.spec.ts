import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeSend } from '../removeSend';
import * as subject from '../removeSend';

const mocks = vi.hoisted(() => ({
    updateTrack: vi.fn(),
    engineRemoveSend: vi.fn(),
}));

vi.mock('../../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    removeSend: mocks.engineRemoveSend,
}));

describe('removeSend', () => {
    it('should export removeSend', () => {
        expect(subject.removeSend).toBeDefined();
        const time = typeof subject.removeSend;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    describe('engine teardown of the live send path', () => {
        beforeEach(() => vi.clearAllMocks());

        // Regression: removeSend used to mutate only the track store, leaving the
        // live send GainNode wired into the bus. The UI showed the send gone while
        // audio kept summing to the bus (and the stale path replicated to peers).
        // The use case must also disconnect the engine send for the same key.
        it('disconnects the live send via the engine pass-through', () => {
            removeSend('t1', 'bus1');

            expect(mocks.engineRemoveSend).toHaveBeenCalledWith('t1', 'bus1');
            expect(mocks.engineRemoveSend).toHaveBeenCalledTimes(1);
        });

        it('still removes the send from project truth before tearing down the node', () => {
            removeSend('t1', 'bus1');

            // The store write removes the bus1 send and leaves the others intact.
            expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
            const updater = mocks.updateTrack.mock.calls[0]![1] as (track: { sends: { busId: string }[] }) => {
                sends: { busId: string }[];
            };
            const next = updater({ sends: [{ busId: 'bus1' }, { busId: 'bus2' }] });
            expect(next.sends).toEqual([{ busId: 'bus2' }]);

            // And the store update is paired with the engine disconnect (no
            // divergence between UI truth and the live graph).
            expect(mocks.engineRemoveSend).toHaveBeenCalledWith('t1', 'bus1');
        });
    });
});
