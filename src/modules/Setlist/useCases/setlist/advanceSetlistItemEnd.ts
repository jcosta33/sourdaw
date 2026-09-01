import { playheadPositionRef, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { secondsBetweenBeats, stopPlayback } from '#/modules/Transport/useCases';

import { setlistStore } from '../../stores/setlistStore';

import { nextItem } from './nextItem';

let startBeat: number | null = null;
let armedIndex: number | null = null;
let wasPlaying = false;
let itemEndConsumed = false;
let lastPlayingBeat: number | null = null;
let pendingAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

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
    itemEndConsumed = false;
    lastPlayingBeat = null;
}

function armItemStart(currentBeat: number, currentIndex: number): void {
    startBeat = currentBeat;
    armedIndex = currentIndex;
    itemEndConsumed = false;
    clearPendingAdvanceTimer();
}

function scheduleAdvanceAfterGap(
    fromIndex: number,
    gapSeconds: number,
    endedItemId: string,
    autoAdvanceWhenScheduled: boolean
): void {
    const delayMs = Math.max(0, gapSeconds) * 1000;
    pendingAdvanceTimer = setTimeout(() => {
        pendingAdvanceTimer = null;
        const latest = setlistStore.value;
        if (!latest || !autoAdvanceWhenScheduled || !latest.autoAdvance) {
            return;
        }
        if (latest.currentIndex !== fromIndex) {
            return;
        }
        const itemAtIndex = latest.items[fromIndex];
        if (itemAtIndex === undefined || itemAtIndex.id !== endedItemId) {
            return;
        }
        nextItem();
    }, delayMs);
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
        clearPendingAdvanceTimer();
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
        // Re-arm only when unset (pause kept the arm) or after a stop relocate wiped it.
        if (currentItem !== undefined && (startBeat === null || armedIndex === null)) {
            armItemStart(currentBeat, currentIndex);
        }
        return;
    }

    lastPlayingBeat = currentBeat;

    if (currentItem === undefined) {
        return;
    }

    if (armedIndex !== currentIndex) {
        armItemStart(currentBeat, currentIndex);
        return;
    }

    // Seek-back and loop wrap both drop the playhead behind the arm point.
    // Re-arm so wrap is not treated as the item finishing.
    if (startBeat !== null && currentBeat < startBeat) {
        if (itemEndConsumed) {
            return;
        }
        armItemStart(currentBeat, currentIndex);
        return;
    }

    if (itemEndConsumed) {
        return;
    }

    if (startBeat === null) {
        armItemStart(currentBeat, currentIndex);
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
        scheduleAdvanceAfterGap(currentIndex, currentItem.gapSeconds, currentItem.id, setlist.autoAdvance);
        return;
    }

    void stopPlayback();
}
