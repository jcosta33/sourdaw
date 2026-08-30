import { describe, expect, it, vi } from 'vitest';

import { createNativeMenuProjectStateController } from '../nativeMenuProjectState.js';

describe('native menu project-state controller', () => {
    it('applies the latest title, dirty indicator, and recent-project projection', () => {
        const window = {
            isDestroyed: () => false,
            setTitle: vi.fn(),
            setDocumentEdited: vi.fn(),
        };
        const updateCloseState = vi.fn();
        const rebuildApplicationMenu = vi.fn();
        const controller = createNativeMenuProjectStateController({
            updateCloseState,
            getWindow: () => window,
            rebuildApplicationMenu,
        });

        controller.apply({ title: 'First mix', dirty: false, recentProjects: [] });
        controller.apply({
            title: 'Final mix',
            dirty: true,
            recentProjects: [{ key: 'sourdaw:project:10', name: 'Final mix' }],
        });

        expect(window.setTitle).toHaveBeenLastCalledWith('Final mix — Sourdaw');
        expect(window.setDocumentEdited).toHaveBeenLastCalledWith(true);
        expect(updateCloseState).toHaveBeenLastCalledWith({
            title: 'Final mix',
            dirty: true,
            recentProjects: [{ key: 'sourdaw:project:10', name: 'Final mix' }],
        });
        expect(rebuildApplicationMenu).toHaveBeenLastCalledWith([{ key: 'sourdaw:project:10', name: 'Final mix' }]);
    });
});
