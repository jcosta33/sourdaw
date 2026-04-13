/**
 * Slice marker state store for Slice mode.
 * Holds onset-detected and user-defined slice markers.
 */

import { createStore } from '#/infra/store/createStore';
import type { SliceMarker } from '../models/SamplerTypes';

export type SliceState = {
    markers: SliceMarker[];
    activeSliceIndex: number;
    autoDetected: boolean;
};

export const defaultSliceState: SliceState = {
    markers: [],
    activeSliceIndex: 0,
    autoDetected: false,
};

export const sliceStore = createStore<SliceState>({
    initialData: defaultSliceState,
});

export function setMarkers(markers: SliceMarker[], autoDetected: boolean): void {
    sliceStore.update((s) => (s ? { ...s, markers, autoDetected, activeSliceIndex: 0 } : s));
}

export function addMarker(framePosition: number): void {
    sliceStore.update((s) => {
        if (!s) {return s;}
        const id = `slice-${crypto.randomUUID()}`;
        const marker: SliceMarker = {
            id,
            framePosition,
            label: `S${s.markers.length + 1}`,
        };
        const markers = [...s.markers, marker].sort((a, b) => a.framePosition - b.framePosition);
        return { ...s, markers, autoDetected: false };
    });
}

export function removeMarker(id: string): void {
    sliceStore.update((s) => {
        if (!s) {return s;}
        const markers = s.markers.filter((m) => m.id !== id);
        return { ...s, markers };
    });
}

export function updateMarkerPosition(id: string, framePosition: number): void {
    sliceStore.update((s) => {
        if (!s) {return s;}
        const markers = s.markers
            .map((m) => (m.id === id ? { ...m, framePosition } : m))
            .sort((a, b) => a.framePosition - b.framePosition);
        return { ...s, markers };
    });
}

export function setActiveSlice(index: number): void {
    sliceStore.update((s) => {
        if (!s || index < 0 || index >= s.markers.length) {return s;}
        return { ...s, activeSliceIndex: index };
    });
}
