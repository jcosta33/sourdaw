import { versionControlStore } from '../../stores/versionControlStore';

export function tagVersion(versionId: string, tag: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }
    versionControlStore.set({
        ...state,
        versions: state.versions.map((v) => (v.id === versionId ? { ...v, tags: [...v.tags, tag] } : v)),
    });
}

export function removeTag(versionId: string, tag: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }
    versionControlStore.set({
        ...state,
        versions: state.versions.map((v) => (v.id === versionId ? { ...v, tags: v.tags.filter((t) => t !== tag) } : v)),
    });
}
