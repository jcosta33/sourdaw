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

    it('defaults to "Host" when name is omitted', () => {
        // The schema marks `name` optional, so a name-less payload must type-check
        // and the handler must supply the documented default rather than `undefined`.
        void handleCreateCollabSession.execute({ type: 'createCollabSession', payload: {} });

        expect(createSession).toHaveBeenCalledWith('Host');
    });
});
