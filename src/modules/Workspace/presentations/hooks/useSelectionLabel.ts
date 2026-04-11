import { useSyncExternalStore } from 'react';
import { workspaceStore } from '../../stores/workspaceStore';
import { trackStore } from '#/modules/Arrangement/stores';

const subscribe = (cb: () => void): (() => void) => {
    const unsub1 = workspaceStore.subscribe(cb);
    const unsub2 = trackStore.subscribe(cb);
    return () => {
        unsub1();
        unsub2();
    };
};

const getSnapshot = (): string => {
    const ids = workspaceStore.value?.selectedClipIds ?? [];
    if (ids.length === 0) {
        return '';
    }
    const allClips = trackStore.value?.tracks.flatMap((t) => t.clips) ?? [];
    if (ids.length === 1) {
        const clip = allClips.find((c) => c.id === ids[0]);
        if (!clip) {
            return '1 clip';
        }
        const beats = clip.endBeat - clip.startBeat;
        const bars = beats / 4;
        return bars === Math.floor(bars)
            ? `1 clip · ${bars} bar${bars !== 1 ? 's' : ''}`
            : `1 clip · ${beats} beat${beats !== 1 ? 's' : ''}`;
    }
    return `${ids.length} clips selected`;
};

/**
 * Derives a human-readable label for the current clip selection.
 * Subscribes to both workspaceStore and trackStore.
 */
export const useSelectionLabel = (): string => {
    return useSyncExternalStore(subscribe, getSnapshot);
};
