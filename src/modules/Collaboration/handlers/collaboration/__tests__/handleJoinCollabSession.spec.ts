import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleJoinCollabSession } from '../handleJoinCollabSession';

const mocks = vi.hoisted(() => ({
    joinSession: vi.fn(),
}));

vi.mock('../../../useCases/collaboration/joinSession', () => ({
    joinSession: mocks.joinSession,
}));

describe('handleJoinCollabSession', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to joinSession use case', async () => {
        await handleJoinCollabSession.execute({
            type: 'joinCollabSession',
            payload: { inviteString: 'abc-123', peerName: 'Alice' },
        });
        expect(mocks.joinSession).toHaveBeenCalledWith('abc-123', 'Alice');
    });

    it('uses default peer name if not provided', async () => {
        await handleJoinCollabSession.execute({
            type: 'joinCollabSession',
            payload: { inviteString: 'xyz' },
        });
        expect(mocks.joinSession).toHaveBeenCalledWith('xyz', 'Peer');
    });

    it('describes itself for the command palette / undo log', () => {
        expect(
            handleJoinCollabSession.describe({ type: 'joinCollabSession', payload: { inviteString: 'abc' } })
        ).toEqual({ label: 'Join collaboration session' });
    });
});
