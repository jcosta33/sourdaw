import { versionControlStore } from '../../../stores/versionControlStore';
import { type VersionControlState } from '../../../models/ProjectVersion';

export function getVersionHistory(): VersionControlState | null {
    return versionControlStore.value;
}