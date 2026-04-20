import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreateCollabSession } from '../handleCreateCollabSession';

vi.mock('../../../useCases/collaboration/sessionManagement', () => ({
    createSession: vi.fn(),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
}));

import { createSession } from '../../../useCases/collaboration/sessionManagement';

describe('collaborationHandlers', () => {
    beforeEach(() => {
        vi.mocked(createSession).mockClear();
    });

    it('handleCreateCollabSession forwards name', () => {
        handleCreateCollabSession.execute({ type: 'createCollabSession', payload: { name: 'Jam' } });

        expect(createSession).toHaveBeenCalledWith('Jam');
    });
});
