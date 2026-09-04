import { playheadPositionRef, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { secondsBetweenBeats, stopPlayback } from '#/modules/Transport/useCases';

import { setlistStore } from '../../stores/setlistStore';

import { nextItem } from './nextItem';

type PendingGap = {
    fromIndex: number;
    endedItemId: string;
    autoAdvance: boolean;
    delayMs: number;
};

let startBeat: number | null = null;
let armedIndex: number | null = null;
let armedItemId: string | null = null;
let wasPlaying = false;
let itemEndConsumed = false;
let lastPlayingBeat: number | null = null;
let pendingAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingGap: PendingGap | null = null;
let frozenGap: PendingGap | null = null;

function clearPendingAdvanceTimer(): void {
    if (pendingAdvanceTimer === null) {
        return;
    }
    clearTimeout(pendingAdvanceTimer);
    pendingAdvanceTimer = null;
}

function clearArm(): void {
    startBeat = null;
    armedIndex = null;
    armedItemId = null;
    itemEndConsumed = false;
    lastPlayingBeat = null;
    pendingGap = null;
    frozenGap = null;
    clearPendingAdvanceTimer();
}

function armItemStart(currentBeat: number, currentIndex: number, itemId: string): void {
    startBeat = currentBeat;
    armedIndex = currentIndex;
    armedItemId = itemId;
    itemEndConsumed = false;
    pendingGap = null;
    frozenGap = null;
    clearPendingAdvanceTimer();
}

function reArmCurrentItem(currentBeat: number): void {
    const latest = setlistStore.value;
    if (!latest) {
        clearArm();
        return;
    }
    const item = latest.items[latest.currentIndex];
    if (item === undefined) {
        clearArm();
        return;
    }
    armItemStart(currentBeat, latest.currentIndex, item.id);
}

function scheduleAdvanceAfterGap(gap: PendingGap): void {
    pendingGap = gap;
    pendingAdvanceTimer = setTimeout(() => {
        pendingAdvanceTimer = null;
        const scheduled = pendingGap;
        pendingGap = null;
        if (scheduled === null) {
            return;
        }
        const latest = setlistStore.value;
        if (!latest || !scheduled.autoAdvance || !latest.autoAdvance) {
            return;
        }
        if (latest.currentIndex !== scheduled.fromIndex) {
            return;
        }
        const itemAtIndex = latest.items[scheduled.fromIndex];
        if (itemAtIndex === undefined || itemAtIndex.id !== scheduled.endedItemId) {
            // Successor inherited the index; do not leave consumed arm stuck on it.
            reArmCurrentItem(playheadPositionRef.current);
            return;
        }
        nextItem();
    }, gap.delayMs);
}

export function advanceSetlistItemEnd(): void {
    const transport = transportStore.value;
    if (!transport) {
        return;
    }

    const currentBeat = playheadPositionRef.current;

    if (!transport.isPlaying) {
        wasPlaying = false;
        // Stop/pause during a gap must not advance after the delay.
        if (pendingAdvanceTimer !== null && pendingGap !== null) {
            frozenGap = pendingGap;
            clearPendingAdvanceTimer();
            // Keep itemEndConsumed so wrap-during-gap protection survives pause.
        } else {
            clearPendingAdvanceTimer();
        }
        // Stop relocates the playhead; pause keeps it. Wipe the arm only on relocate.
        if (lastPlayingBeat !== null && currentBeat !== lastPlayingBeat) {
            clearArm();
        }
        return;
    }

    const setlist = setlistStore.value;
    if (!setlist) {
        return;
    }

    const { currentIndex, items } = setlist;
    const currentItem = items[currentIndex];

    if (!wasPlaying) {
        wasPlaying = true;
        lastPlayingBeat = currentBeat;
        if (frozenGap !== null) {
            const gap = frozenGap;
            frozenGap = null;
            scheduleAdvanceAfterGap(gap);
            return;
        }
        // Re-arm only when unset (pause kept the arm) or after a stop relocate wiped it.
        if (currentItem !== undefined && (startBeat === null || armedIndex === null || armedItemId === null)) {
            armItemStart(currentBeat, currentIndex, currentItem.id);
        }
        return;
    }

    lastPlayingBeat = currentBeat;

    if (currentItem === undefined) {
        return;
    }

    if (armedIndex !== currentIndex || armedItemId !== currentItem.id) {
        armItemStart(currentBeat, currentIndex, currentItem.id);
        return;
    }

    // Seek-back and loop wrap both drop the playhead behind the arm point.
    // Re-arm so wrap is not treated as the item finishing.
    if (startBeat !== null && currentBeat < startBeat) {
        if (itemEndConsumed) {
            return;
        }
        armItemStart(currentBeat, currentIndex, currentItem.id);
        return;
    }

    if (itemEndConsumed) {
        return;
    }

    if (startBeat === null) {
        armItemStart(currentBeat, currentIndex, currentItem.id);
        return;
    }

    if (currentItem.estimatedDuration <= 0) {
        return;
    }

    const elapsedSeconds = secondsBetweenBeats(
        tempoMapStore.value?.changes ?? [],
        startBeat,
        currentBeat,
        transport.tempo
    );

    if (elapsedSeconds < currentItem.estimatedDuration) {
        return;
    }

    itemEndConsumed = true;

    if (currentItem.autoStop) {
        void stopPlayback();
        return;
    }

    if (!setlist.autoAdvance) {
        return;
    }

    if (currentIndex + 1 < items.length) {
        scheduleAdvanceAfterGap({
            fromIndex: currentIndex,
            endedItemId: currentItem.id,
            autoAdvance: setlist.autoAdvance,
            delayMs: Math.max(0, currentItem.gapSeconds) * 1000,
        });
        return;
    }

    void stopPlayback();
}
