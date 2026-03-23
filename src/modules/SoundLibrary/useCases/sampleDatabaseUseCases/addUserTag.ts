import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

export function addUserTag(sampleId: string, tagName: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) =>
            s.id === sampleId
                ? {
                      ...s,
                      tags: [...s.tags, { name: tagName, source: 'user' as const, confidence: 1 }],
                  }
                : s
        ),
    });
}
