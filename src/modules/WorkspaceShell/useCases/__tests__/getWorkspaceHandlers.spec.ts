import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { openPreferencesDialog } from '../dialogs/openPreferencesDialog';
import { getWorkspaceHandlers } from '../getWorkspaceHandlers';

const mocks = vi.hoisted(() => ({
    eventBus: {
        emit: vi.fn().mockResolvedValue(undefined),
    },
}));

describe('getWorkspaceHandlers', () => {
    beforeEach(() => {
        injectDependencies(openPreferencesDialog, { eventBus: mocks.eventBus });
        mocks.eventBus.emit.mockClear();
    });

    it('returns a fresh map containing every workspace command handler', () => {
        const map = getWorkspaceHandlers();

        // spot check a representative cross-section of action types
        for (const key of [
            'setWorkspaceMode',
            'openMixer',
            'toggleSidebar',
            'importMidiFile',
            'zoomToFit',
            'exportProject',
            'newProject',
            'openPreferencesDialog',
        ] as const) {
            expect(map[key]).toBeDefined();
            expect(map[key].execute).toBeDefined();
        }

        expect(getWorkspaceHandlers()).not.toBe(map);
    });

    it('executes preferences opening through the Workspace dialog use case', () => {
        const map = getWorkspaceHandlers();

        map.openPreferencesDialog.execute({ type: 'openPreferencesDialog' });

        expect(mocks.eventBus.emit).toHaveBeenCalledWith('dialog.openPreferences', undefined);
        expect(map.openPreferencesDialog.describe({ type: 'openPreferencesDialog' })).toEqual({
            label: 'Open preferences',
        });
        expect(map.openPreferencesDialog.undoable).toBe(false);
    });
});
