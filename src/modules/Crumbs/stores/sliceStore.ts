/**
 * Slice marker state store for Slice mode.
 * Holds onset-detected and user-defined slice markers.
 */

import { createStore } from '#/infra/store/createStore';

import type { SliceMarker } from '../models/CrumbsTypes';

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

export const sliceStore = createStore<Record<string, SliceState>>({
    initialData: {},
});

export function ensureSliceInstance(instanceId: string): void {
    sliceStore.update((s) => {
        if (!s) {
            return {};
        }
        if (s[instanceId]) {
            return s;
        }
        return { ...s, [instanceId]: { ...defaultSliceState } };
    });
}

export function setMarkers(instanceId: string, markers: SliceMarker[], autoDetected: boolean): void {
    sliceStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        if (!inst) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...inst, markers, autoDetected, activeSliceIndex: 0 },
        };
    });
}

export function addMarker(instanceId: string, framePosition: number): void {
    sliceStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        if (!inst) {
            return s;
        }
        const id = `slice-${crypto.randomUUID()}`;
        const marker: SliceMarker = {
            id,
            framePosition,
            label: `S${inst.markers.length + 1}`,
        };
        const markers = [...inst.markers, marker].sort((a, b) => a.framePosition - b.framePosition);
        return {
            ...s,
            [instanceId]: { ...inst, markers, autoDetected: false },
        };
    });
}

export function removeMarker(instanceId: string, id: string): void {
    sliceStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        if (!inst) {
            return s;
        }
        const markers = inst.markers.filter((m) => m.id !== id);
        return {
            ...s,
            [instanceId]: { ...inst, markers },
        };
    });
}

export function updateMarkerPosition(instanceId: string, id: string, framePosition: number): void {
    sliceStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        if (!inst) {
            return s;
        }
        const markers = inst.markers
            .map((m) => (m.id === id ? { ...m, framePosition } : m))
            .sort((a, b) => a.framePosition - b.framePosition);
        return {
            ...s,
            [instanceId]: { ...inst, markers },
        };
    });
}

export function setActiveSlice(instanceId: string, index: number): void {
    sliceStore.update((s) => {
        if (!s) {
            return {};
        }
        const inst = s[instanceId];
        if (!inst || index < 0 || index >= inst.markers.length) {
            return s;
        }
        return {
            ...s,
            [instanceId]: { ...inst, activeSliceIndex: index },
        };
    });
}

export function removeSliceInstance(instanceId: string): void {
    sliceStore.update((s) => {
        if (!s) {
            return {};
        }
        const next = { ...s };
        delete next[instanceId];
        return next;
    });
}
