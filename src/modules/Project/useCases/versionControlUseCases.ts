/**
 * Version Control Use Cases
 *
 * Git-style project versioning: create snapshots, branch, merge,
 * tag versions, and restore any previous state.
 */

import { versionControlStore } from '../stores/versionControlStore';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { markerStore } from '#/modules/Timeline/stores/markerStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import {
    type ProjectSnapshot,
    type VersionControlState,
    createVersion,
    createBranch,
} from '../models/ProjectVersion';

// ── Snapshot Helpers ──────────────────────────────────────────────────

function captureSnapshot(): ProjectSnapshot {
    const data = JSON.stringify({
        tracks: trackStore.value,
        markers: markerStore.value,
        transport: transportStore.value,
        timestamp: Date.now(),
    });
    return { data, size: new Blob([data]).size };
}

function restoreSnapshot(snapshot: ProjectSnapshot): void {
    try {
        const parsed = JSON.parse(snapshot.data);
        if (parsed.tracks) {
            trackStore.set(parsed.tracks);
        }
        if (parsed.markers) {
            markerStore.set(parsed.markers);
        }
        if (parsed.transport) {
            transportStore.set(parsed.transport);
        }
    } catch {
        /* corrupt snapshot */
    }
}

// ── Create Version ───────────────────────────────────────────────────

export function createProjectVersion(label: string, description: string = '', tags: string[] = []): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    const snapshot = captureSnapshot();
    const version = createVersion(label, description, snapshot, state.currentVersionId, tags);

    // Update the current branch head
    const branches = state.branches.map((b) =>
        b.id === state.currentBranchId ? { ...b, headVersionId: version.id } : b
    );

    versionControlStore.set({
        ...state,
        versions: [...state.versions, version],
        branches,
        currentVersionId: version.id,
    });
}

// ── Auto-save ────────────────────────────────────────────────────────

export function autoSaveVersion(): void {
    const state = versionControlStore.value;
    if (!state || state.autoSaveInterval <= 0) {
        return;
    }

    createProjectVersion(`Auto-save ${new Date().toLocaleTimeString()}`, 'Automatic checkpoint', ['auto-save']);
}

// ── Restore Version ──────────────────────────────────────────────────

export function restoreVersion(versionId: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    const version = state.versions.find((v) => v.id === versionId);
    if (!version || !version.snapshot.data) {
        return;
    }

    restoreSnapshot(version.snapshot);

    versionControlStore.set({
        ...state,
        currentVersionId: versionId,
    });
}

// ── Branching ────────────────────────────────────────────────────────

export function createVersionBranch(name: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    const branch = createBranch(name, state.currentVersionId ?? '');

    versionControlStore.set({
        ...state,
        branches: [...state.branches, branch],
        currentBranchId: branch.id,
    });
}

export function switchBranch(branchId: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    const branch = state.branches.find((b) => b.id === branchId);
    if (!branch) {
        return;
    }

    // Restore the branch head version
    const headVersion = state.versions.find((v) => v.id === branch.headVersionId);
    if (headVersion?.snapshot.data) {
        restoreSnapshot(headVersion.snapshot);
    }

    versionControlStore.set({
        ...state,
        currentBranchId: branchId,
        currentVersionId: branch.headVersionId || null,
    });
}

export function deleteBranch(branchId: string): void {
    const state = versionControlStore.value;
    if (!state || branchId === state.currentBranchId) {
        return; // Cannot delete current branch
    }

    versionControlStore.set({
        ...state,
        branches: state.branches.filter((b) => b.id !== branchId),
    });
}

// ── Tags ─────────────────────────────────────────────────────────────

export function tagVersion(versionId: string, tag: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    versionControlStore.set({
        ...state,
        versions: state.versions.map((v) =>
            v.id === versionId ? { ...v, tags: [...v.tags, tag] } : v
        ),
    });
}

export function removeTag(versionId: string, tag: string): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }

    versionControlStore.set({
        ...state,
        versions: state.versions.map((v) =>
            v.id === versionId ? { ...v, tags: v.tags.filter((t) => t !== tag) } : v
        ),
    });
}

// ── Queries ──────────────────────────────────────────────────────────

export function getVersionHistory(): VersionControlState | null {
    return versionControlStore.value;
}

export function getVersionCount(): number {
    return versionControlStore.value?.versions.length ?? 0;
}

export function getBranchCount(): number {
    return versionControlStore.value?.branches.length ?? 0;
}

export function getCurrentBranchName(): string {
    const state = versionControlStore.value;
    if (!state) {
        return 'main';
    }
    return state.branches.find((b) => b.id === state.currentBranchId)?.name ?? 'main';
}

export function setAutoSaveInterval(minutes: number): void {
    const state = versionControlStore.value;
    if (!state) {
        return;
    }
    versionControlStore.set({ ...state, autoSaveInterval: minutes });
}
