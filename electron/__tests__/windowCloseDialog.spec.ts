import { describe, expect, it, vi } from 'vitest';

import { askToSaveBeforeClose } from '../windowCloseDialog.js';

describe('native window close dialog', () => {
    it.each([
        [0, 'save'],
        [1, 'discard'],
        [2, 'cancel'],
        [99, 'cancel'],
    ] as const)('maps native response %s to %s with the loss-safe dialog policy', async (response, decision) => {
        const window = { isDestroyed: () => false };
        const dialog = { showMessageBox: vi.fn(async () => ({ response })) };

        await expect(askToSaveBeforeClose({ window, dialog, title: 'Song' })).resolves.toBe(decision);
        expect(dialog.showMessageBox).toHaveBeenCalledWith(window, {
            type: 'warning',
            buttons: ['Save', 'Don’t Save', 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            message: 'Do you want to save the changes you made to “Song”?',
            detail: 'Your changes will be lost if you do not save them.',
        });
    });

    it('cancels without opening a dialog after its parent is gone', async () => {
        const dialog = { showMessageBox: vi.fn() };
        await expect(
            askToSaveBeforeClose({ window: { isDestroyed: () => true }, dialog, title: 'Song' })
        ).resolves.toBe('cancel');
        expect(dialog.showMessageBox).not.toHaveBeenCalled();
    });
});
