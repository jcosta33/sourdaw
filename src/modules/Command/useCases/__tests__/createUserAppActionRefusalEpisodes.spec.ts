import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { AppActionConflictError } from '../../errors/AppActionExecutionError';
import { createUserAppActionRefusalEpisodes } from '../createUserAppActionRefusalEpisodes';
import { executeAppAction } from '../executeAppAction';

vi.mock('../executeAppAction', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../executeAppAction')>()),
    executeAppAction: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const action = { type: 'addTrack', payload: { name: 'New track', kind: 'audio' } } as const;
const refuse = () => vi.mocked(executeAppAction).mockRejectedValueOnce(new AppActionConflictError('addTrack'));

describe('createUserAppActionRefusalEpisodes', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(executeAppAction).mockResolvedValue(undefined);
    });

    it('notifies once for a sweep of refused executes on one key', async () => {
        const episodes = createUserAppActionRefusalEpisodes();
        for (let step = 0; step < 20; step++) {
            refuse();
            await expect(episodes.execute('device-1', action)).resolves.toBeUndefined();
        }

        expect(notifyUser).toHaveBeenCalledTimes(1);
        expect(notifyUser).toHaveBeenCalledWith(
            "Add track was refused because the project can't be changed right now. Further edits to this device are not saved until the project can be changed.",
            'warning'
        );
    });

    it('notifies again for a refusal after a successful execute on that key', async () => {
        const episodes = createUserAppActionRefusalEpisodes();
        refuse();
        await episodes.execute('device-1', action);
        await episodes.execute('device-1', action);
        refuse();
        await episodes.execute('device-1', action);

        expect(notifyUser).toHaveBeenCalledTimes(2);
    });

    it('starts a new episode after end(key)', async () => {
        const episodes = createUserAppActionRefusalEpisodes();
        refuse();
        await episodes.execute('device-1', action);
        episodes.end('device-1');
        refuse();
        await episodes.execute('device-1', action);

        expect(notifyUser).toHaveBeenCalledTimes(2);
    });

    it('starts new episodes for every key after endAll()', async () => {
        const episodes = createUserAppActionRefusalEpisodes();
        refuse();
        await episodes.execute('device-1', action);
        refuse();
        await episodes.execute('device-2', action);
        episodes.endAll();
        refuse();
        await episodes.execute('device-1', action);
        refuse();
        await episodes.execute('device-2', action);

        expect(notifyUser).toHaveBeenCalledTimes(4);
    });

    it('keeps one key episode independent of another', async () => {
        const episodes = createUserAppActionRefusalEpisodes();
        refuse();
        await episodes.execute('device-1', action);
        refuse();
        await episodes.execute('device-2', action);
        refuse();
        await episodes.execute('device-1', action);
        // A success on device-2 ends only device-2's episode.
        await episodes.execute('device-2', action);
        refuse();
        await episodes.execute('device-1', action);

        expect(notifyUser).toHaveBeenCalledTimes(2);
    });

    it('rejects a non-conflict failure unchanged and notifies nothing', async () => {
        const episodes = createUserAppActionRefusalEpisodes();
        const failure = new Error('disk full');
        vi.mocked(executeAppAction).mockRejectedValueOnce(failure);

        await expect(episodes.execute('device-1', action)).rejects.toBe(failure);
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
