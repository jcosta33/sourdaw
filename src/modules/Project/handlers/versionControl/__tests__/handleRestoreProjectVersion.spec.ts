import { describe, it, expect, vi, beforeEach } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { restoreVersion } from '../../../useCases/versionControl/restoreVersion';
import { handleRestoreProjectVersion } from '../handleRestoreProjectVersion';

vi.mock('../../../useCases/versionControl/restoreVersion', () => ({
    restoreVersion: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

describe('handleRestoreProjectVersion', () => {
    beforeEach(() => {
        vi.mocked(restoreVersion).mockReset();
        vi.mocked(notifyUser).mockReset();
    });

    it('is not undoable — restore overwrites stores with no captured pre-state', () => {
        expect(handleRestoreProjectVersion.undoable).toBe(false);
    });

    it('notifies the user when the version has no restorable snapshot', async () => {
        vi.mocked(restoreVersion).mockReturnValue(false);

        await handleRestoreProjectVersion.execute({
            type: 'restoreProjectVersion',
            payload: { versionId: 'v1' },
        });

        expect(restoreVersion).toHaveBeenCalledWith('v1');
        expect(notifyUser).toHaveBeenCalledWith('This version has no restorable snapshot', 'error');
    });

    it('does not notify when the restore succeeds', async () => {
        vi.mocked(restoreVersion).mockReturnValue(true);

        await handleRestoreProjectVersion.execute({
            type: 'restoreProjectVersion',
            payload: { versionId: 'v1' },
        });

        expect(restoreVersion).toHaveBeenCalledWith('v1');
        expect(notifyUser).not.toHaveBeenCalled();
    });
});
