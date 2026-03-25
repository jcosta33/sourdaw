// Version creation
export { createProjectVersion } from './createProjectVersion';
export { autoSaveVersion } from './autoSaveVersion';

// Restore
export { restoreVersion } from './restoreVersion';

// Branching
export { createVersionBranch, switchBranch, deleteBranch } from './branching';

// Tags
export { tagVersion, removeTag } from './tagging';

// Queries
export { getVersionHistory, getVersionCount, getBranchCount, getCurrentBranchName, setAutoSaveInterval } from './queries';

// Re-export types
export type { VersionControlState, ProjectSnapshot } from '../../models/ProjectVersion';
