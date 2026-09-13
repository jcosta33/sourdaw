import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSession } from '../../../useCases/collaboration/createSession';
import { handleCreateCollabSession } from '../handleCreateCollabSession';

vi.mock('../../../useCases/collaboration/createSession', () => ({
    createSession: vi.fn(),
}));

describe('collaborationHandlers', () => {
    beforeEach(() => {
        vi.mocked(createSession).mockReset().mockResolvedValue('session-id');
    });

    it('handleCreateCollabSession forwards name', async () => {
        await handleCreateCollabSession.execute({ type: 'createCollabSession', payload: { name: 'Jam' } });

        expect(createSession).toHaveBeenCalledWith('Jam');
    });

    it('defaults to "Host" when name is omitted', async () => {
        // The schema marks `name` optional, so a name-less payload must type-check
        // and the handler must supply the documented default rather than `undefined`.
        await handleCreateCollabSession.execute({ type: 'createCollabSession', payload: {} });

        expect(createSession).toHaveBeenCalledWith('Host');
    });

    it('does not complete until durable session creation settles', async () => {
        const creation = Promise.withResolvers<string>();
        vi.mocked(createSession).mockReturnValueOnce(creation.promise);

        const execution = handleCreateCollabSession.execute({ type: 'createCollabSession', payload: { name: 'Jam' } });
        let completed = false;
        void execution.then(() => {
            completed = true;
        });
        await Promise.resolve();
        expect(completed).toBe(false);

        creation.resolve('session-id');
        await execution;
    });

    it('describes itself for the command palette / undo log', () => {
        expect(handleCreateCollabSession.describe({ type: 'createCollabSession', payload: {} })).toEqual({
            label: 'Create collaboration session',
        });
    });
});
