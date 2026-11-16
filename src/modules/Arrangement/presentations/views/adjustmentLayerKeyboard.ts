import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { handleRovingRowKeyDown } from '#/utils/UI/rovingRowKeyboard';

import type { AdjustmentRegion } from '../../stores/adjustmentLayer';

// A focused layer row treats the playhead as its cursor: Enter adds a region
// there, the route Alt+click takes at the pointer. A focused region opens its
// inspector on Enter, as a double-click does, and moves by arrow nudges; its
// edge separators resize it by the same nudges.

/** The shortest region a resize may leave, by pointer or keyboard. */
export const MIN_REGION_BEATS = 0.25;
/** Arrow keys nudge a region or its edge by a sixteenth; Shift nudges by a beat. */
const NUDGE_BEATS = 0.25;
const LARGE_NUDGE_BEATS = 1;

export type RegionEdge = 'start' | 'end';

type MenuPosition = { x: number; y: number };

type LayerRowKeyActions = {
    openMenu: (position: MenuPosition) => void;
    addRegionAtPlayhead: () => void;
};

type RegionKeyActions = {
    openMenu: (position: MenuPosition) => void;
    openInspector: () => void;
    remove: () => void;
    move: (startBeat: number, endBeat: number) => void;
};

const opensContextMenu = (event: ReactKeyboardEvent): boolean =>
    event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');

const isPlainKey = (event: ReactKeyboardEvent, key: string): boolean =>
    event.key === key && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

/** The arrow nudge a key asks for, or null for any other key. */
const readNudgeBeats = (event: ReactKeyboardEvent): number | null => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
        return null;
    }
    const step = event.shiftKey ? LARGE_NUDGE_BEATS : NUDGE_BEATS;
    if (event.key === 'ArrowLeft') {
        return -step;
    }
    return event.key === 'ArrowRight' ? step : null;
};

const claimKey = (event: ReactKeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
};

const menuPositionBelow = (element: HTMLElement): MenuPosition => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
};

export const handleLayerRowKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, actions: LayerRowKeyActions) => {
    if (event.target !== event.currentTarget) {
        return;
    }
    if (opensContextMenu(event)) {
        claimKey(event);
        actions.openMenu(menuPositionBelow(event.currentTarget));
        return;
    }
    // Space stays the transport's; only Enter adds a region.
    if (event.key === ' ') {
        return;
    }
    handleRovingRowKeyDown(event, 'vertical', actions.addRegionAtPlayhead);
};

export const handleRegionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    region: AdjustmentRegion,
    actions: RegionKeyActions
) => {
    if (opensContextMenu(event)) {
        claimKey(event);
        actions.openMenu(menuPositionBelow(event.currentTarget));
        return;
    }
    if (isPlainKey(event, 'Enter')) {
        claimKey(event);
        actions.openInspector();
        return;
    }
    if (isPlainKey(event, 'Delete') || isPlainKey(event, 'Backspace')) {
        claimKey(event);
        actions.remove();
        return;
    }
    const nudge = readNudgeBeats(event);
    if (nudge === null) {
        return;
    }
    claimKey(event);
    const startBeat = Math.max(0, region.startBeat + nudge);
    actions.move(startBeat, startBeat + (region.endBeat - region.startBeat));
};

export const handleRegionEdgeKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    region: AdjustmentRegion,
    edge: RegionEdge,
    move: (startBeat: number, endBeat: number) => void
) => {
    const nudge = readNudgeBeats(event);
    if (nudge === null) {
        return;
    }
    claimKey(event);
    if (edge === 'start') {
        const startBeat = Math.max(0, Math.min(region.startBeat + nudge, region.endBeat - MIN_REGION_BEATS));
        move(startBeat, region.endBeat);
        return;
    }
    const endBeat = Math.max(region.startBeat + MIN_REGION_BEATS, region.endBeat + nudge);
    move(region.startBeat, endBeat);
};
