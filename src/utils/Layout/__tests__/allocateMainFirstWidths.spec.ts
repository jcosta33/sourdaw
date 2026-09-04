import { describe, expect, it } from 'vitest';

import { defaultWorkspaceState } from '#/modules/WorkspaceShell/stores';

import {
    allocateMainFirstWidths,
    ARRANGE_RESIZE_HANDLE_WIDTH,
    MIN_ARRANGE_COLUMN_WIDTH,
    MIN_TIMELINE_COLUMN_WIDTH,
    MIN_TRACK_LIST_WIDTH,
    SHELL_RESIZE_HANDLE_WIDTH,
} from '../allocateMainFirstWidths';

describe('allocateMainFirstWidths', () => {
    it('keeps preferred side widths when the main column already has its minimum', () => {
        const allocated = allocateMainFirstWidths({
            available: 1000,
            minMain: MIN_TIMELINE_COLUMN_WIDTH,
            sides: [{ preferred: 220, min: MIN_TRACK_LIST_WIDTH }],
        });

        expect(allocated.sides).toEqual([220]);
        expect(allocated.main).toBe(780);
    });

    it('returns preferred side widths when available width is still unmeasured', () => {
        const allocated = allocateMainFirstWidths({
            available: 0,
            minMain: MIN_TIMELINE_COLUMN_WIDTH,
            sides: [{ preferred: 220, min: MIN_TRACK_LIST_WIDTH }],
        });

        expect(allocated.sides).toEqual([220]);
        expect(allocated.main).toBe(0);
    });

    it('cannot give the timeline 0 CSS width at a 640px 200% viewport with default panels open', () => {
        // Nightly display-scale iframe: innerWidth 640, defaults from WorkspaceState,
        // inspector minWidth 200, sidebar minWidth 180, both panels plus track list open.
        const viewportWidth = 640;
        const shellHandles = 2 * SHELL_RESIZE_HANDLE_WIDTH;
        const shell = allocateMainFirstWidths({
            available: viewportWidth - shellHandles,
            minMain: MIN_ARRANGE_COLUMN_WIDTH,
            sides: [
                { preferred: defaultWorkspaceState.sidebarWidth, min: 180 },
                { preferred: defaultWorkspaceState.inspectorWidth, min: 200 },
            ],
        });

        expect(shell.main).toBeGreaterThan(0);
        expect(shell.main).toBeGreaterThanOrEqual(MIN_ARRANGE_COLUMN_WIDTH);
        expect(shell.sides[0]).toBeLessThan(defaultWorkspaceState.sidebarWidth);
        expect(shell.sides[1]).toBeLessThan(defaultWorkspaceState.inspectorWidth);
        expect(shell.sides[0]! + shell.sides[1]! + shell.main + shellHandles).toBeCloseTo(viewportWidth);

        const arrange = allocateMainFirstWidths({
            available: shell.main - ARRANGE_RESIZE_HANDLE_WIDTH,
            minMain: MIN_TIMELINE_COLUMN_WIDTH,
            sides: [{ preferred: defaultWorkspaceState.trackListWidth, min: MIN_TRACK_LIST_WIDTH }],
        });

        expect(arrange.main).toBeGreaterThan(0);
        expect(arrange.main).toBeGreaterThanOrEqual(MIN_TIMELINE_COLUMN_WIDTH);
        expect(arrange.sides[0]).toBeGreaterThan(0);
        expect(arrange.sides[0]! + arrange.main + ARRANGE_RESIZE_HANDLE_WIDTH).toBeCloseTo(shell.main);
    });

    it('shrinks sides below their comfort min rather than zeroing the main column', () => {
        const allocated = allocateMainFirstWidths({
            available: 100,
            minMain: MIN_TIMELINE_COLUMN_WIDTH,
            sides: [
                { preferred: 220, min: MIN_TRACK_LIST_WIDTH },
                { preferred: 256, min: 200 },
            ],
        });

        expect(allocated.main).toBeGreaterThan(0);
        expect(allocated.main).toBeGreaterThanOrEqual(MIN_TIMELINE_COLUMN_WIDTH);
        expect(allocated.sides.every((width) => width < 120)).toBe(true);
    });
});
