import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSession } from '../../../useCases/collaboration/createSession';
import { handleCreateCollabSession } from '../handleCreateCollabSession';

vi.mock('../../../useCases/collaboration/createSession', () => ({
    createSession: vi.fn(),
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

    it('describes itself for the command palette / undo log', () => {
        expect(handleCreateCollabSession.describe({ type: 'createCollabSession', payload: {} })).toEqual({
            label: 'Create collaboration session',
        });
    });
});
