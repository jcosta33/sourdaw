import { markerStore } from '#/modules/Arrangement/stores';

import type { MarkerStoreState } from '#/modules/Arrangement/stores';

type MarkerRecord = MarkerStoreState['markers'][number];

type MarkerInput = { beat: number; name: string; color?: string };

export function addMarkers(markers: MarkerInput[]): void {
    const existing = markerStore.value ?? { markers: [], sections: [] };
    const defaultColor = 'oklch(0.38 0.08 270)';
    const newMarkers: MarkerRecord[] = markers.map((marker) => ({
        id: crypto.randomUUID(),
        beat: marker.beat,
        name: marker.name,
        color: marker.color ?? defaultColor,
    }));
    markerStore.set({
        markers: [...existing.markers, ...newMarkers],
        sections: existing.sections,
    });
}
