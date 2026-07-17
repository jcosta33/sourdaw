import { grooveStore } from '#/modules/Arrangement/stores';

type SetGrooveInput = {
    id: string;
    name: string;
    offsets: number[];
    resolution: number;
    intensity: number;
};

export function setGroove(input: SetGrooveInput): void {
    const existing = grooveStore.value?.templates ?? [];
    grooveStore.set({
        templates: [
            ...existing.filter((template) => template.id !== input.id),
            {
                id: input.id,
                name: input.name,
                offsets: input.offsets,
                resolution: input.resolution,
            },
        ],
        projectGrooveId: input.id,
        projectGrooveIntensity: input.intensity,
    });
}
