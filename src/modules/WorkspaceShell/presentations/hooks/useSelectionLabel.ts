import { useSyncExternalStore } from 'react';

import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { transportStore } from '#/modules/Transport/stores';

/** Beats per bar when transport state is unavailable. */
const FALLBACK_BEATS_PER_BAR = 4;

const subscribe = (cb: () => void): (() => void) => {
    const unsub1 = clipSelectionStore.subscribe(cb);
    const unsub2 = trackStore.subscribe(cb);
    const unsub3 = transportStore.subscribe(cb);
    return () => {
        unsub1();
        unsub2();
        unsub3();
    };
};

const getSnapshot = (): string => {
    const ids = clipSelectionStore.value?.selectedClipIds ?? [];
    if (ids.length === 0) {
        return '';
    }
    const allClips = trackStore.value?.tracks.flatMap((time) => time.clips) ?? [];
    if (ids.length === 1) {
        const clip = allClips.find((context) => context.id === ids[0]);
        if (!clip) {
            return '1 clip';
        }
        const beats = clip.endBeat - clip.startBeat;
        // Bars come from the transport time signature, not a hardcoded 4: in 3/4 a
        // 3-bar clip is 9 beats, which /4 renders as "2.25 bars" and then silently
        // falls back to beats phrasing.
        const beatsPerBar = transportStore.value?.timeSignatureNumerator ?? FALLBACK_BEATS_PER_BAR;
        const bars = beats / beatsPerBar;
        return bars === Math.floor(bars)
            ? `1 clip · ${bars} bar${bars !== 1 ? 's' : ''}`
            : `1 clip · ${beats} beat${beats !== 1 ? 's' : ''}`;
    }
    return `${ids.length} clips selected`;
};

/**
 * Derives a human-readable label for the current clip selection.
 * Subscribes to both clipSelectionStore and trackStore.
 */
export const useSelectionLabel = (): string => {
    return useSyncExternalStore(subscribe, getSnapshot);
};
