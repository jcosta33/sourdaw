import { describe, expect, it } from 'vitest';

import {
    allocateMainFirstWidths,
    MIN_ARRANGE_COLUMN_WIDTH,
    SHELL_RESIZE_HANDLE_WIDTH,
} from '#/utils/Layout/allocateMainFirstWidths';

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

    it('keeps a decoded open sidebar visible through the real shell allocation', () => {
        const allocateSidebar = (sidebarWidth: number): number => {
            const decoded = decodeProjectWorkingView({ version: 1, workspace: { sidebarWidth, sidebarOpen: true } });
            if (!decoded) {
                throw new Error('Expected the current working-view envelope to decode');
            }
            expect(decoded.workspace.sidebarOpen).toBe(true);
            return allocateMainFirstWidths({
                available: 1024 - SHELL_RESIZE_HANDLE_WIDTH,
                minMain: MIN_ARRANGE_COLUMN_WIDTH,
                sides: [{ preferred: decoded.workspace.sidebarWidth, min: 180 }],
            }).sides[0]!;
        };

        expect(allocateSidebar(280)).toBe(280);
        expect(allocateSidebar(280.5)).toBe(280.5);
        expect(allocateSidebar(1e308)).toBeGreaterThan(0);
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

    it.each([
        ['sidebarWidth', 280.5, 180, 500],
        ['inspectorWidth', 280.5, 200, 500],
        ['trackListWidth', 220.5, 120, 400],
        ['sessionViewWidth', 320.5, 200, 800],
        ['virtualKeyboardHeight', 128.5, 80, 400],
    ] as const)('restores %s within its owning resize bounds without rounding', (field, fraction, min, max) => {
        const decode = (value: number) => decodeProjectWorkingView({ version: 1, workspace: { [field]: value } });
        expect(decode(fraction)?.workspace[field]).toBe(fraction);
        expect(decode(0)?.workspace[field]).toBe(min);
        expect(decode(1e308)?.workspace[field]).toBe(max);
        expect(decode(Number.NaN)?.workspace[field]).toBe(createDefaultProjectWorkingView().workspace[field]);
    });

    it('keeps large fractional arrangement offsets independent of panel bounds', () => {
        const decoded = decodeProjectWorkingView({
            version: 1,
            timeline: { scrollX: 1e12 + 0.5, scrollY: 1e10 + 0.25, pixelsPerBeat: 20 },
        });
        expect(decoded?.timeline).toEqual({ scrollX: 1e12 + 0.5, scrollY: 1e10 + 0.25, pixelsPerBeat: 20 });
        expect(decodeProjectWorkingView(createDefaultProjectWorkingView())).toEqual(createDefaultProjectWorkingView());
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
