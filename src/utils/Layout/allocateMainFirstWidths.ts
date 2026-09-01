export type PanelWidthDemand = {
    preferred: number;
    min: number;
};

export type AllocatedMainFirstWidths = {
    main: number;
    sides: number[];
};

/** CSS pixels. A 16px-inset host click at 200% UI scale needs a visible canvas. */
export const MIN_TIMELINE_COLUMN_WIDTH = 80;

/** Matches `DragResizeHandle` `w-[5px]`. */
export const SHELL_RESIZE_HANDLE_WIDTH = 5;

/** Matches TimelineEditor `ResizeHandle` `w-1` (4px). */
export const ARRANGE_RESIZE_HANDLE_WIDTH = 4;

export const MIN_TRACK_LIST_WIDTH = 120;

export const MIN_ARRANGE_COLUMN_WIDTH = MIN_TRACK_LIST_WIDTH + ARRANGE_RESIZE_HANDLE_WIDTH + MIN_TIMELINE_COLUMN_WIDTH;

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

const shrinkTowardFloors = (allocated: readonly number[], floors: readonly number[], take: number): number[] => {
    const next = [...allocated];
    if (take <= 0) {
        return next;
    }

    const slack = next.map((width, index) => Math.max(0, width - (floors[index] ?? 0)));
    const totalSlack = sum(slack);
    if (totalSlack <= 0) {
        return next;
    }

    const planned = Math.min(take, totalSlack);
    let remaining = planned;
    for (let index = 0; index < next.length; index += 1) {
        const sideSlack = slack[index] ?? 0;
        if (sideSlack <= 0) {
            continue;
        }

        const laterSlack = sum(slack.slice(index + 1));
        const portion = laterSlack <= 0 ? remaining : (sideSlack / totalSlack) * planned;
        const shrink = Math.min(sideSlack, remaining, portion);
        next[index] = (next[index] ?? 0) - shrink;
        remaining -= shrink;
    }

    for (let index = 0; index < next.length && remaining > 0; index += 1) {
        const extra = Math.min(remaining, Math.max(0, (next[index] ?? 0) - (floors[index] ?? 0)));
        next[index] = (next[index] ?? 0) - extra;
        remaining -= extra;
    }

    return next;
};

export const allocateMainFirstWidths = ({
    available,
    minMain,
    sides,
}: {
    available: number;
    minMain: number;
    sides: readonly PanelWidthDemand[];
}): AllocatedMainFirstWidths => {
    const preferred = sides.map((side) => Math.max(0, side.preferred));
    if (available <= 0) {
        return { main: 0, sides: preferred };
    }

    const targetMain = Math.max(0, minMain);
    let allocated = preferred;
    let main = available - sum(allocated);
    if (main >= targetMain) {
        return { main, sides: allocated };
    }

    allocated = shrinkTowardFloors(
        allocated,
        sides.map((side) => Math.max(0, side.min)),
        targetMain - main
    );
    main = available - sum(allocated);
    if (main < targetMain) {
        allocated = shrinkTowardFloors(
            allocated,
            sides.map(() => 0),
            targetMain - main
        );
        main = available - sum(allocated);
    }

    if (main < 1 && available >= 1) {
        for (let index = 0; index < allocated.length && main < 1; index += 1) {
            const steal = Math.min(allocated[index] ?? 0, 1 - main);
            allocated[index] = (allocated[index] ?? 0) - steal;
            main += steal;
        }
    }

    return { main, sides: allocated };
};
