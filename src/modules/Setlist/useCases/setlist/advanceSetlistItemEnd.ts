import { playheadPositionRef, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { secondsBetweenBeats, stopPlayback } from '#/modules/Transport/useCases';

import { setlistStore } from '../../stores/setlistStore';

import { nextItem } from './nextItem';

let startBeat: number | null = null;
let armedIndex: number | null = null;
let wasPlaying = false;
let itemEndConsumed = false;
let pendingAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

function clearPendingAdvanceTimer(): void {
    if (pendingAdvanceTimer === null) {
        return;
    }
    clearTimeout(pendingAdvanceTimer);
    pendingAdvanceTimer = null;
}

function armItemStart(currentBeat: number, currentIndex: number): void {
    startBeat = currentBeat;
    armedIndex = currentIndex;
    itemEndConsumed = false;
    clearPendingAdvanceTimer();
}

function scheduleAdvanceAfterGap(fromIndex: number, gapSeconds: number): void {
    const delayMs = Math.max(0, gapSeconds) * 1000;
    pendingAdvanceTimer = setTimeout(() => {
        pendingAdvanceTimer = null;
        const latest = setlistStore.value;
        if (!latest || latest.currentIndex !== fromIndex) {
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
        startBeat = null;
        armedIndex = null;
        itemEndConsumed = false;
        clearPendingAdvanceTimer();
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
        if (currentItem !== undefined) {
            armItemStart(currentBeat, currentIndex);
        }
        return;
    }

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
        scheduleAdvanceAfterGap(currentIndex, currentItem.gapSeconds);
        return;
    }

    void stopPlayback();
}
