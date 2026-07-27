import { describe, it, expect, vi, beforeEach } from 'vitest';

import { removeSend } from '../removeSend';
import * as subject from '../removeSend';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
    engineRemoveSend: vi.fn(),
    engineSetSend: vi.fn(),
}));

vi.mock('../../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));
vi.mock('../../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    removeSend: mocks.engineRemoveSend,
    setSend: mocks.engineSetSend,
}));

describe('removeSend', () => {
    it('should export removeSend', () => {
        expect(subject.removeSend).toBeDefined();
        const time = typeof subject.removeSend;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    describe('engine teardown of the live send path', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            mocks.getTrackById.mockReturnValue({ sends: [{ busId: 'bus1' }] });
        });

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

        it('defers live engine teardown until the project transaction commits', () => {
            const runtimeEffect = removeSend('t1', 'bus1', { deferRuntimeEffect: true });

            expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
            expect(mocks.engineRemoveSend).not.toHaveBeenCalled();
            if (!runtimeEffect) {
                throw new Error('expected a deferred runtime effect');
            }
            runtimeEffect.afterCommit();
            runtimeEffect.afterCommit();
            expect(mocks.engineRemoveSend).toHaveBeenCalledOnce();
            expect(mocks.engineRemoveSend).toHaveBeenCalledWith('t1', 'bus1');

            mocks.getTrackById.mockReturnValue({
                sends: [{ busId: 'bus1', level: 0.4, preFader: true }],
            });
            runtimeEffect.afterAmbiguousCommit();
            expect(mocks.engineSetSend).toHaveBeenCalledWith('t1', 'bus1', 0.4, true);
        });

        it('does not mutate project or engine state when the send does not exist', () => {
            mocks.getTrackById.mockReturnValue({ sends: [] });

            expect(removeSend('t1', 'bus1')).toBe(false);
            expect(mocks.updateTrack).not.toHaveBeenCalled();
            expect(mocks.engineRemoveSend).not.toHaveBeenCalled();
        });
    });
});
