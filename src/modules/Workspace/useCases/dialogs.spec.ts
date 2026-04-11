import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { openExportDialog } from './dialogs/openExportDialog';
import { openPreferencesDialog } from './dialogs/openPreferencesDialog';
import { onDialogOpenExport } from './dialogs/onDialogOpenExport';
import { onDialogOpenPreferences } from './dialogs/onDialogOpenPreferences';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
};

describe('dialogs', () => {
    it('should emit dialog.openExport when openExportDialog is called', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(openExportDialog, { eventBus });

        openExportDialog();

        expect(eventBus.emit).toHaveBeenCalledWith('dialog.openExport', undefined);
    });

    it('should emit dialog.openPreferences when openPreferencesDialog is called', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(openPreferencesDialog, { eventBus });

        openPreferencesDialog();

        expect(eventBus.emit).toHaveBeenCalledWith('dialog.openPreferences', undefined);
    });

    it('should subscribe to dialog.openExport via onDialogOpenExport', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onDialogOpenExport, { eventBus });

        const handler = vi.fn();
        const result = onDialogOpenExport(handler);

        expect(eventBus.on).toHaveBeenCalledWith('dialog.openExport', handler);
        expect(result).toBe(unsubscribe);
    });

    it('should subscribe to dialog.openPreferences via onDialogOpenPreferences', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onDialogOpenPreferences, { eventBus });

        const handler = vi.fn();
        const result = onDialogOpenPreferences(handler);

        expect(eventBus.on).toHaveBeenCalledWith('dialog.openPreferences', handler);
        expect(result).toBe(unsubscribe);
    });
});
