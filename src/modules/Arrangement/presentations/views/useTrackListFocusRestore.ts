import { type FocusEvent, type RefObject, useLayoutEffect, useRef } from 'react';

/**
 * The one row that takes Tab: the selected track's row while the list draws it,
 * else the first drawn row, so the list stays reachable when nothing is
 * selected or the selection sits in a collapsed folder or a hidden track.
 */
export function getTabStopTrackId(rows: readonly { id: string }[], selectedTrackId: string | null): string | null {
    if (selectedTrackId !== null && rows.some((row) => row.id === selectedTrackId)) {
        return selectedTrackId;
    }
    return rows[0]?.id ?? null;
}

/**
 * Where focus goes once the focused row is gone: the first row after it in the
 * previous order that survives, else the nearest surviving row before it.
 */
function getNeighbourRowId(
    previousIds: readonly string[],
    removedId: string,
    currentIds: readonly string[]
): string | null {
    const removedIndex = previousIds.indexOf(removedId);
    if (removedIndex < 0) {
        return currentIds[0] ?? null;
    }
    const surviving = (id: string): boolean => currentIds.includes(id);
    const after = previousIds.slice(removedIndex + 1).find(surviving);
    if (after !== undefined) {
        return after;
    }
    return previousIds.slice(0, removedIndex).findLast(surviving) ?? null;
}

const ROW_ID_SEPARATOR = '\u0000';

/**
 * Focus is adrift on the body, or still on the row's own context menu, which
 * closes with its row and could only hand focus back to an element that is gone.
 */
function isFocusAdrift(active: Element | null): boolean {
    return active === null || active === document.body || active.closest('[role="menu"]') !== null;
}

type FocusRestoreHandlers = {
    onFocus: (event: FocusEvent<HTMLDivElement>) => void;
    onBlur: (event: FocusEvent<HTMLDivElement>) => void;
};

/**
 * Keeps keyboard focus in the track list when the focused row leaves it:
 * remembers the focused row, and once that row is no longer drawn moves focus
 * to its surviving neighbour, else to the grid.
 */
export function useTrackListFocusRestore(
    gridRef: RefObject<HTMLDivElement | null>,
    drawnRowIds: readonly string[]
): FocusRestoreHandlers {
    const focusedRowIdRef = useRef<string | null>(null);
    const previousRowIdsRef = useRef<string[]>([]);
    const rowIdsKey = drawnRowIds.join(ROW_ID_SEPARATOR);

    // A row that removes itself (Delete Track, Hide Track) takes focus with it
    // and leaves it on the body, so focus moves to the neighbour that took its
    // place, else to the grid itself when no row is left.
    useLayoutEffect(() => {
        const rowIds = rowIdsKey === '' ? [] : rowIdsKey.split(ROW_ID_SEPARATOR);
        const previousIds = previousRowIdsRef.current;
        previousRowIdsRef.current = rowIds;
        const focusedId = focusedRowIdRef.current;
        if (focusedId === null || rowIds.includes(focusedId)) {
            return;
        }
        focusedRowIdRef.current = null;
        const grid = gridRef.current;
        if (!grid || !isFocusAdrift(document.activeElement)) {
            return;
        }
        const neighbourId = getNeighbourRowId(previousIds, focusedId, rowIds);
        if (neighbourId === null) {
            grid.focus();
            return;
        }
        const neighbourRow = Array.from(grid.children).find(
            (child): child is HTMLElement =>
                child instanceof HTMLElement && child.getAttribute('data-track-id') === neighbourId
        );
        (neighbourRow ?? grid).focus();
    }, [gridRef, rowIdsKey]);

    const handleRowFocus = (event: FocusEvent<HTMLDivElement>): void => {
        // A portaled menu's focus bubbles through React to here; it is not a row.
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) {
            return;
        }
        const row = event.target instanceof Element ? event.target.closest('[data-track-id]') : null;
        focusedRowIdRef.current = row?.getAttribute('data-track-id') ?? null;
    };

    // Focus that leaves the list for the page (or any other control) is no
    // longer the list's to restore. Moving into the row's portaled menu keeps it.
    const handleRowBlur = (event: FocusEvent<HTMLDivElement>): void => {
        const grid = event.currentTarget;
        if (!(event.target instanceof Node) || !grid.contains(event.target)) {
            return;
        }
        const next = event.relatedTarget;
        if (next instanceof Element && (grid.contains(next) || next.closest('[role="menu"]') !== null)) {
            return;
        }
        // Chromium fires blur (relatedTarget null) on a focused element as it is
        // removed from the DOM, before React's layout effect runs. Wait a
        // microtask: a removed row is disconnected by then and the restore
        // effect has already used the ref; a row that merely lost focus is not.
        const row = event.target instanceof Element ? event.target.closest('[data-track-id]') : null;
        queueMicrotask(() => {
            const active = document.activeElement;
            if (row?.isConnected && !(active && (grid.contains(active) || active.closest('[role="menu"]')))) {
                focusedRowIdRef.current = null;
            }
        });
    };

    return { onFocus: handleRowFocus, onBlur: handleRowBlur };
}
