import { versionControlStore } from '../../../stores/versionControlStore';

export function tagVersion(versionId: string, tag: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }
    versionControlStore.set({
        ...state,
        versions: state.versions.map((value) =>
            value.id === versionId ? { ...value, tags: [...value.tags, tag] } : value
        ),
    });
}
