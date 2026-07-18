import { sampleDatabaseStore } from '../../stores/sampleDatabaseStore';

/**
 * Append a user-authored tag to a sample. Empty/whitespace-only names are
 * rejected, and a tag already present on the sample (compared case-insensitively
 * against existing tag names) is not added again.
 */
export function addUserTag(sampleId: string, tagName: string): void {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return;
    }
    const trimmed = tagName.trim();
    if (trimmed === '') {
        return;
    }
    sampleDatabaseStore.set({
        ...state,
        samples: state.samples.map((s) => {
            if (s.id !== sampleId) {
                return s;
            }
            const lowered = trimmed.toLowerCase();
            if (s.tags.some((t) => t.name.toLowerCase() === lowered)) {
                return s;
            }
            return {
                ...s,
                tags: [...s.tags, { name: trimmed, source: 'user' as const, confidence: 1 }],
            };
        }),
    });
}
