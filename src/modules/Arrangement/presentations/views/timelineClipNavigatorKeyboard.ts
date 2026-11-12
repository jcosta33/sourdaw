import type { KeyboardEvent, RefObject } from 'react';

import { setClipSelection } from '../../useCases/clipSelection/setClipSelection';

import type { TimelineClip } from './timelineClipNavigatorModel';

type KeyboardOptions = {
    readonly active: TimelineClip | undefined;
    readonly activeIndex: number;
    readonly filteredClips: readonly TimelineClip[];
    readonly selected: ReadonlySet<string>;
    readonly selectedIds: readonly string[];
    readonly listboxRef: RefObject<HTMLDivElement | null>;
    readonly moveTo: (index: number) => void;
    readonly commitActive: () => void;
    readonly onClose: () => void;
};

function moveRelative(options: KeyboardOptions, offset: number): void {
    const index = Math.min(Math.max(options.activeIndex + offset, 0), options.filteredClips.length - 1);
    options.moveTo(index);
}

function toggleActiveSelection(options: KeyboardOptions): void {
    const { active, selected, selectedIds } = options;
    if (!active) {
        return;
    }
    if (selected.has(active.clip.id)) {
        setClipSelection(selectedIds.filter((clipId) => clipId !== active.clip.id));
        return;
    }
    setClipSelection([...selectedIds, active.clip.id]);
}

function handleSearchKeyDown(options: KeyboardOptions, event: KeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation();
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
        return;
    }
    event.preventDefault();
    if (event.key === 'Enter') {
        options.commitActive();
        return;
    }
    if (event.key === 'Escape') {
        options.onClose();
        return;
    }
    moveRelative(options, event.key === 'ArrowDown' ? 1 : -1);
    options.listboxRef.current?.focus();
}

function handleListKeyDown(options: KeyboardOptions, event: KeyboardEvent<HTMLDivElement>): void {
    const claimed = ['ArrowDown', 'ArrowUp', 'Home', 'End', ' ', 'Spacebar', 'Enter', 'Escape'];
    if (!claimed.includes(event.key)) {
        event.stopPropagation();
        return;
    }
    event.preventDefault();
    event.stopPropagation();

    switch (event.key) {
        case 'ArrowDown':
            moveRelative(options, 1);
            break;
        case 'ArrowUp':
            moveRelative(options, -1);
            break;
        case 'Home':
            options.moveTo(0);
            break;
        case 'End':
            options.moveTo(options.filteredClips.length - 1);
            break;
        case ' ':
        case 'Spacebar':
            toggleActiveSelection(options);
            break;
        case 'Enter':
            options.commitActive();
            break;
        case 'Escape':
            options.onClose();
            break;
    }
}

export function getTimelineClipNavigatorKeyboardHandlers(options: KeyboardOptions): {
    readonly handleSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    readonly handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
} {
    return {
        handleSearchKeyDown: (event) => handleSearchKeyDown(options, event),
        handleKeyDown: (event) => handleListKeyDown(options, event),
    };
}
