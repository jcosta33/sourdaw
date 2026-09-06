/**
 * Built-in Version Control
 *
 * Git-compatible branching/history via snapshot-based project diffs.
 * Each version captures a serializable snapshot of the full project state
 * (tracks, clips, automation, mixer, markers) with metadata.
 */

export type ProjectSnapshot = {
    /** Canonical project identity that owned this snapshot at capture time. */
    ownerProjectId: string;
    /** Serialized project state (tracks, clips, transport, markers, etc.) */
    data: string;
    /** Byte size of the snapshot */
    size: number;
};

export type ProjectVersion = {
    id: string;
    /** Human-readable label */
    label: string;
    /** ISO 8601 timestamp */
    createdAt: string;
    /** Parent version ID (null for root) */
    parentId: string | null;
    /** Diff description: what changed since parent */
    description: string;
    /** Snapshot of the project at this version */
    snapshot: ProjectSnapshot;
    /** Tags for quick reference */
    tags: string[];
};

export type VersionBranch = {
    id: string;
    name: string;
    /** ID of the version at the tip of this branch */
    headVersionId: string;
    /** When this branch was created */
    createdAt: string;
};

export type VersionControlState = {
    versions: ProjectVersion[];
    branches: VersionBranch[];
    currentBranchId: string;
    currentVersionId: string | null;
    /** Auto-save interval in minutes (0 = disabled) */
    autoSaveInterval: number;
};

export function createVersion(
    label: string,
    description: string,
    snapshot: ProjectSnapshot,
    parentId: string | null,
    tags: string[] = []
): ProjectVersion {
    return {
        id: `ver-${crypto.randomUUID()}`,
        label,
        createdAt: new Date().toISOString(),
        parentId,
        description,
        snapshot,
        tags,
    };
}

export function createBranch(name: string, headVersionId: string): VersionBranch {
    return {
        id: `branch-${crypto.randomUUID()}`,
        name,
        headVersionId,
        createdAt: new Date().toISOString(),
    };
}

export function createDefaultState(): VersionControlState {
    const mainBranch = createBranch('main', '');
    return {
        versions: [],
        branches: [mainBranch],
        currentBranchId: mainBranch.id,
        currentVersionId: null,
        autoSaveInterval: 5,
    };
}
