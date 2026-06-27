import { beforeEach, describe, it, expect, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { onDialogOpenExport } from '../dialogs/onDialogOpenExport';
import { onDialogOpenPreferences } from '../dialogs/onDialogOpenPreferences';
import { openExportDialog } from '../dialogs/openExportDialog';
import { openPreferencesDialog } from '../dialogs/openPreferencesDialog';

const mocks = vi.hoisted(() => ({
    mockEventBus: {
        emit: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
    },
}));

describe('dialogs', () => {
    beforeEach(() => {
        injectDependencies(openExportDialog, { eventBus: mocks.mockEventBus });
        mocks.mockEventBus.emit.mockClear();
        mocks.mockEventBus.on.mockClear();
    });

    it('should emit dialog.openExport when openExportDialog is called', () => {
        openExportDialog();

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('dialog.openExport', undefined);
    });

    it('should emit dialog.openPreferences when openPreferencesDialog is called', () => {
        openPreferencesDialog();

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('dialog.openPreferences', undefined);
    });

    it('should subscribe to dialog.openExport via onDialogOpenExport', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        const result = onDialogOpenExport(handler);

        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('dialog.openExport', handler);
        expect(result).toBe(unsubscribe);
    });

    it('should subscribe to dialog.openPreferences via onDialogOpenPreferences', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        const result = onDialogOpenPreferences(handler);

        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('dialog.openPreferences', handler);
        expect(result).toBe(unsubscribe);
    });
});
