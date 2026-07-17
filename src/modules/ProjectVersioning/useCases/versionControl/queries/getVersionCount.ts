import { versionControlStore } from '../../../stores/versionControlStore';

export function getVersionCount(): number {
    return versionControlStore.value?.versions.length ?? 0;
}
