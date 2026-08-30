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

        controller.apply({
            title: 'First mix',
            dirty: false,
            durabilityPending: false,
            projectId: 'first',
            revision: 'revision-1',
            recentProjects: [],
        });
        controller.apply({
            title: 'Final mix',
            dirty: true,
            durabilityPending: false,
            projectId: 'final',
            revision: 'revision-2',
            recentProjects: [{ key: 'sourdaw:project:10', name: 'Final mix' }],
        });

        expect(window.setTitle).toHaveBeenLastCalledWith('Final mix — Sourdaw');
        expect(window.setDocumentEdited).toHaveBeenLastCalledWith(true);
        expect(updateCloseState).toHaveBeenLastCalledWith({
            title: 'Final mix',
            dirty: true,
            durabilityPending: false,
            projectId: 'final',
            revision: 'revision-2',
            recentProjects: [{ key: 'sourdaw:project:10', name: 'Final mix' }],
        });
        expect(rebuildApplicationMenu).toHaveBeenLastCalledWith([{ key: 'sourdaw:project:10', name: 'Final mix' }]);
    });

    it('keeps a clean replacement visibly edited while its identity snapshot is pending', () => {
        const window = {
            isDestroyed: () => false,
            setTitle: vi.fn(),
            setDocumentEdited: vi.fn(),
        };
        const controller = createNativeMenuProjectStateController({
            updateCloseState: vi.fn(),
            getWindow: () => window,
            rebuildApplicationMenu: vi.fn(),
        });

        controller.apply({
            title: 'Untitled Project',
            dirty: false,
            durabilityPending: true,
            projectId: 'untitled',
            revision: 'revision-1',
            recentProjects: [],
        });

        expect(window.setDocumentEdited).toHaveBeenCalledWith(true);
    });
});
