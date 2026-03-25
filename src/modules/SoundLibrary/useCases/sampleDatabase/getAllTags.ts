import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

export function getAllTags(): string[] {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return [];
    }
    const tagSet = new Set<string>();
    for (const sample of state.samples) {
        for (const tag of sample.tags) {
            tagSet.add(tag.name);
        }
    }
    return [...tagSet].sort();
}
