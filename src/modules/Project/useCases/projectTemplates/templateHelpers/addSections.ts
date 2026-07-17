import { markerStore } from '#/modules/Arrangement/stores';

import type { MarkerStoreState } from '#/modules/Arrangement/stores';

type SectionRecord = MarkerStoreState['sections'][number];

type SectionInput = { startBeat: number; endBeat: number; name: string; color?: string };

export function addSections(sections: SectionInput[]): void {
    const existing = markerStore.value ?? { markers: [], sections: [] };
    const defaultColor = 'oklch(0.40 0.07 200)';
    const newSections: SectionRecord[] = sections.map((section) => ({
        id: crypto.randomUUID(),
        startBeat: section.startBeat,
        endBeat: section.endBeat,
        name: section.name,
        color: section.color ?? defaultColor,
    }));
    markerStore.set({
        markers: existing.markers,
        sections: [...existing.sections, ...newSections],
    });
}
