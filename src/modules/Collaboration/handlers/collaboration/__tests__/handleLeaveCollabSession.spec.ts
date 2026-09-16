import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleLeaveCollabSession } from '../handleLeaveCollabSession';

const mocks = vi.hoisted(() => ({
    leaveSession: vi.fn(),
}));

vi.mock('../../../useCases/collaboration/leaveSession', () => ({
    leaveSession: mocks.leaveSession,
}));

describe('handleLeaveCollabSession', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.leaveSession.mockResolvedValue(undefined);
    });

    it('delegates to leaveSession use case', async () => {
        await handleLeaveCollabSession.execute({
            type: 'leaveCollabSession',
            payload: undefined,
        });
        expect(mocks.leaveSession).toHaveBeenCalledTimes(1);
    });

    it('propagates teardown failure through the handler promise', async () => {
        const failure = new Error('durable teardown failed');
        mocks.leaveSession.mockRejectedValueOnce(failure);

        await expect(handleLeaveCollabSession.execute({ type: 'leaveCollabSession', payload: undefined })).rejects.toBe(
            failure
        );
    });

    it('describes itself for the command palette / undo log', () => {
        expect(handleLeaveCollabSession.describe({ type: 'leaveCollabSession', payload: undefined })).toEqual({
            label: 'Leave collaboration session',
        });
    });
});
