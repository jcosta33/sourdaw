import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomergeSync } from './automergeSync';

describe('AutomergeSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('subscribes to CRDT changes on start using injected dependencies', () => {
        const subscribeToCrdtChanges = vi.fn().mockReturnValue(() => {});
        const peerManager = {
            getConnectedPeerIds: vi.fn().mockReturnValue([]),
            sendCrdtSync: vi.fn(),
        };

        const sync = new AutomergeSync(peerManager as never, {
            subscribeToCrdtChanges,
            getCrdtDoc: vi.fn(),
            createCrdtDoc: vi.fn(),
            replaceCrdtDoc: vi.fn(),
            hasCrdtDoc: vi.fn(),
            getCrdtDocIds: vi.fn().mockReturnValue([]),
            persistCrdtProject: vi.fn().mockResolvedValue(undefined),
        });

        sync.start();

        expect(subscribeToCrdtChanges).toHaveBeenCalledTimes(1);
    });
});
