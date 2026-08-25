# ProjectVersioning module — Agent Guidelines

User-facing snapshot version control for projects, including point-in-time milestone creation, version restoration, tagging, version branching, and periodic autosave snapshots (live multi-peer CRDT history belongs to CrdtDocument).

## Public Contract Surface

- `stores`: `versionControlStore` (`VersionControlState`).
- `useCases`: `getVersionControlHandlers`.
- Handlers: `getVersionControlHandlers` (`createProjectVersion`, `restoreProjectVersion`, `createVersionBranch`).

## Key Subsystems

- **Snapshot Management**: `snapshotHelpers/captureSnapshot.ts` serializes active project state; `snapshotHelpers/restoreSnapshot.ts` hydrates a historical snapshot back into active stores.
- **Version Lifecycle**: `createProjectVersion.ts`, `restoreVersion.ts`, `autoSaveVersion.ts` handle milestone commits and background autosave versions.
- **Branching**: `branching/createVersionBranch.ts`, `branching/switchBranch.ts`, `branching/deleteBranch.ts` manage user milestone branches.
- **Tagging**: `tagging/tagVersion.ts`, `tagging/removeTag.ts` label specific milestones.
- **Version Queries**: `queries/` provide history lookups, version counts, active branch name, and autosave interval configuration.

## Invariants & Traps

- **Snapshot vs CRDT Branches**: Version control branches represent user-created snapshot milestones, distinct from Automerge collaborative branches in `CrdtDocument`.
- **Destructive Restore Guard**: Restoring a version replaces current active project state; uncommitted modifications should be verified or versioned beforehand.
- **Non-Blocking Autosave**: Autosave snapshots run periodically without blocking UI rendering or audio thread deadlines.

## Verification

```bash
pnpm vitest run src/modules/ProjectVersioning
```
