import { useSyncExternalStore } from 'react';

import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { formatMusicalLength } from '#/modules/Transport/useCases';

const subscribe = (cb: () => void): (() => void) => {
    const unsub1 = clipSelectionStore.subscribe(cb);
    const unsub2 = trackStore.subscribe(cb);
    const unsub3 = transportStore.subscribe(cb);
    const unsub4 = timeSignatureMapStore.subscribe(cb);
    return () => {
        unsub1();
        unsub2();
        unsub3();
        unsub4();
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
        // Length reads through the project's meter map (bars.beats.sixteenths), so a
        // meter change or a non-4/4 project never skews it; whole bars read as "N bars".
        const length = formatMusicalLength(clip.startBeat, clip.endBeat - clip.startBeat);
        const wholeBars = /^(\d+)\.0\.0$/.exec(length)?.[1];
        if (wholeBars !== undefined && wholeBars !== '0') {
            return `1 clip · ${wholeBars} bar${wholeBars === '1' ? '' : 's'}`;
        }
        return `1 clip · ${length}`;
    }
    return `${ids.length} clips selected`;
};

/**
 * Derives a human-readable label for the current clip selection.
 * Subscribes to clipSelectionStore, trackStore and transportStore — the last one
 * because lengths depend on the meter map.
 */
export const useSelectionLabel = (): string => {
    return useSyncExternalStore(subscribe, getSnapshot);
};
