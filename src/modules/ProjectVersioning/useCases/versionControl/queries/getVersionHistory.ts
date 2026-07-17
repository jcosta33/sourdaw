import { type VersionControlState } from '../../../models/ProjectVersion';
import { versionControlStore } from '../../../stores/versionControlStore';

export function getVersionHistory(): VersionControlState | null {
    return versionControlStore.value;
}
