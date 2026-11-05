import { useSyncExternalStore } from 'react';

import { clipSelectionStore, trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { formatMusicalLengthParts, measureMusicalLength } from '#/modules/Transport/useCases';

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
        // Length reads through the project's meter map, so a meter change or a non-4/4
        // project never skews it; whole bars read as "N bars".
        const transport = transportStore.value ?? defaultTransportState;
        const length = measureMusicalLength({
            startBeat: clip.startBeat,
            lengthBeats: clip.endBeat - clip.startBeat,
            changes: timeSignatureMapStore.value?.changes ?? [],
            defaultNumerator: transport.timeSignatureNumerator,
            defaultDenominator: transport.timeSignatureDenominator,
        });
        if (length.beats === 0 && length.sixteenths === 0 && length.bars > 0) {
            return `1 clip · ${length.bars} bar${length.bars === 1 ? '' : 's'}`;
        }
        return `1 clip · ${formatMusicalLengthParts(length)}`;
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
