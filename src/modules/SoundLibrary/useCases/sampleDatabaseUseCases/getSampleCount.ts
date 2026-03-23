import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

export function getSampleCount(): number {
    return sampleDatabaseStore.value?.samples.length ?? 0;
}
