import { describe, expect, it } from 'vitest';

import { defaultWorkspaceState } from '../WorkspaceState';

describe('defaultWorkspaceState', () => {
    it('should open arrange workflow with select tool and common panels', () => {
        expect(defaultWorkspaceState.mode).toBe('arrange');
        expect(defaultWorkspaceState.activeTool).toBe('select');
        expect(defaultWorkspaceState.sidebarOpen).toBe(true);
        expect(defaultWorkspaceState.inspectorOpen).toBe(true);
        expect(defaultWorkspaceState.mixerOpen).toBe(false);
        expect(defaultWorkspaceState.commandPaletteOpen).toBe(false);
    });

    it('should clear selection and use musical time by default', () => {
        expect(defaultWorkspaceState.selectedClipId).toBeNull();
        expect(defaultWorkspaceState.selectedClipIds).toEqual([]);
        expect(defaultWorkspaceState.timeDisplayMode).toBe('musical');
        expect(defaultWorkspaceState.soloMode).toBe('sip');
    });

    it('should expose default panel dimensions', () => {
        expect(defaultWorkspaceState.sidebarWidth).toBe(224);
        expect(defaultWorkspaceState.inspectorWidth).toBe(256);
        expect(defaultWorkspaceState.snapValue).toBe(1);
        expect(defaultWorkspaceState.virtualKeyboardOctave).toBe(4);
        expect(defaultWorkspaceState.virtualKeyboardVelocity).toBe(100);
    });
});
