import { describe, expect, it } from 'vitest';

import {
    captureProjectWorkingView,
    createDefaultProjectWorkingView,
    decodeProjectWorkingView,
    projectWorkingViewEquals,
} from '../ProjectWorkingView';
import { defaultWorkspaceState } from '../WorkspaceState';

describe('ProjectWorkingView', () => {
    it('captures only durable timeline and working-panel fields', () => {
        const view = captureProjectWorkingView({
            workspace: {
                ...defaultWorkspaceState,
                mode: 'clip',
                sidebarWidth: 312,
                sidebarOpen: false,
                virtualKeyboardOpen: true,
                activeTool: 'draw',
                commandPaletteOpen: true,
                undoHistoryOpen: true,
                chatPanelOpen: true,
                scratchPadCollapsed: true,
                timelineMinimapPreviewHeight: 90,
            },
            timeline: {
                scrollX: 480,
                scrollY: 120,
                pixelsPerBeat: 24,
            },
        });

        expect(view).toMatchObject({
            version: 1,
            timeline: { scrollX: 480, scrollY: 120, pixelsPerBeat: 24 },
            workspace: {
                mode: 'clip',
                sidebarWidth: 312,
                sidebarOpen: false,
                virtualKeyboardOpen: true,
            },
        });
        expect(view.workspace).not.toHaveProperty('activeTool');
        expect(view.workspace).not.toHaveProperty('commandPaletteOpen');
        expect(view.workspace).not.toHaveProperty('undoHistoryOpen');
        expect(view.workspace).not.toHaveProperty('chatPanelOpen');
        expect(view.workspace).not.toHaveProperty('scratchPadCollapsed');
        expect(view.workspace).not.toHaveProperty('timelineMinimapPreviewHeight');
        expect(view.timeline).not.toHaveProperty('autoScrollEnabled');
        expect(view.timeline).not.toHaveProperty('viewportWidth');
    });

    it('falls back field by field for malformed or older partial records', () => {
        const decoded = decodeProjectWorkingView({
            version: 1,
            timeline: { scrollX: 240, scrollY: -1, pixelsPerBeat: Number.NaN },
            workspace: {
                mode: 'automation',
                sidebarOpen: 'yes',
                sidebarWidth: 280,
                commandPaletteOpen: true,
            },
        });

        expect(decoded).toEqual({
            ...createDefaultProjectWorkingView(),
            timeline: { scrollX: 240, scrollY: 0, pixelsPerBeat: 12 },
            workspace: {
                ...createDefaultProjectWorkingView().workspace,
                mode: 'automation',
                sidebarWidth: 280,
            },
        });
        expect(decoded?.workspace).not.toHaveProperty('commandPaletteOpen');
    });

    it.each([null, 'corrupt', [], { version: 0 }, { version: 2 }])('rejects an unreadable envelope %j', (value) => {
        expect(decodeProjectWorkingView(value)).toBeNull();
    });

    it('compares the persistent snapshot rather than unrelated session state', () => {
        const first = captureProjectWorkingView({
            workspace: defaultWorkspaceState,
            timeline: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12 },
        });
        const second = captureProjectWorkingView({
            workspace: {
                ...defaultWorkspaceState,
                commandPaletteOpen: true,
                activeTool: 'cut',
                timelineMinimapPreviewHeight: 72,
            },
            timeline: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12 },
        });

        expect(projectWorkingViewEquals(first, second)).toBe(true);
        expect(
            projectWorkingViewEquals(first, {
                ...second,
                timeline: { ...second.timeline, scrollX: 48 },
            })
        ).toBe(false);
    });
});
