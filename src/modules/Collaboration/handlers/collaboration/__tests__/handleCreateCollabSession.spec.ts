import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSession } from '../../../useCases/collaboration/sessionManagement';
import { handleCreateCollabSession } from '../handleCreateCollabSession';

vi.mock('../../../useCases/collaboration/sessionManagement', () => ({
    createSession: vi.fn(),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
}));

describe('collaborationHandlers', () => {
    beforeEach(() => {
        vi.mocked(createSession).mockClear();
    });

    it('handleCreateCollabSession forwards name', () => {
        void handleCreateCollabSession.execute({ type: 'createCollabSession', payload: { name: 'Jam' } });

        expect(createSession).toHaveBeenCalledWith('Jam');
    });
});
