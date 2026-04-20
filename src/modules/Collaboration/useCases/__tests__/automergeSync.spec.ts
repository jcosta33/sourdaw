import { describe, it, expect, vi, beforeEach } from 'vitest';

import { subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';

import { AutomergeSync } from '../automergeSync';

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    subscribeToCrdtChanges: vi.fn(),
    getCrdtDoc: vi.fn(),
    createCrdtDoc: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    hasCrdtDoc: vi.fn(),
    getCrdtDocIds: vi.fn().mockReturnValue([]),
    persistCrdtProject: vi.fn().mockResolvedValue(undefined),
}));

describe('AutomergeSync', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('subscribes to CRDT changes on start using injected dependencies', () => {
        vi.mocked(subscribeToCrdtChanges).mockReturnValue(() => {});
        const peerManager = {
            getConnectedPeerIds: vi.fn().mockReturnValue([]),
            sendCrdtSync: vi.fn(),
        };

        const sync = new AutomergeSync(peerManager as never);

        sync.start();

        expect(subscribeToCrdtChanges).toHaveBeenCalledTimes(1);
    });
});
