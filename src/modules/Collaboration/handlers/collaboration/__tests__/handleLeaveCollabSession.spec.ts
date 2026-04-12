import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleLeaveCollabSession } from '../handleLeaveCollabSession';

const mocks = vi.hoisted(() => ({
    leaveSession: vi.fn(),
}));

vi.mock('../../../useCases/collaboration/sessionManagement', () => ({
    leaveSession: mocks.leaveSession,
}));

describe('handleLeaveCollabSession', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to leaveSession use case', () => {
        handleLeaveCollabSession.execute({
            type: 'leaveCollabSession',
            payload: {}
        });
        expect(mocks.leaveSession).toHaveBeenCalledTimes(1);
    });
});
