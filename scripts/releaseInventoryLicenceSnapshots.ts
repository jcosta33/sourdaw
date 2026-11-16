import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    curatedDependencyLicenseProofsProjection,
    licenceInputProjectionKind,
    type LicenceInputProjection,
} from './dependencyLicenseInputProjection.ts';
import { DEPENDENCY_LICENSE_PROOFS_PATH } from './dependencyLicenseReport.ts';

/**
 * Snapshots pinned by the licence-input projection the dependency licence proof pins them by, so
 * an edit the proof cannot see (a new script, a crate `[lints]` table) leaves the inventory alone.
 */
export const LICENCE_PROJECTED_SNAPSHOT_PATHS: readonly string[] = ['package.json', 'Cargo.toml'];

/**
 * Pins only the hand-curated `packages` proofs. The proof file's generated Cargo runtime inventory
 * is checked live by the licence preflight against Cargo.lock, the licence-input projections and
 * the dependency licence report, which this surface still pins whole.
 */
export function curatedDependencyLicenseProofsDigest(root: string): string {
    const projection = curatedDependencyLicenseProofsProjection(
        readFileSync(resolve(root, DEPENDENCY_LICENSE_PROOFS_PATH), 'utf8'),
        DEPENDENCY_LICENSE_PROOFS_PATH
    );
    const digest = createHash('sha256').update(projection, 'utf8').digest('hex');
    return `sha256:${digest}:@curated-packages:${DEPENDENCY_LICENSE_PROOFS_PATH}`;
}

type SnapshotDigests = {
    fileDigests: Record<string, string>;
    snapshotProjectionDigests: Record<string, string>;
};

/** The error for a tracked, well-formed snapshot entry whose digest does not hold, if any. */
export function licenceSnapshotError(
    entry: { path: string; projection?: LicenceInputProjection; sha256: string },
    snapshot: SnapshotDigests
): string | undefined {
    if (!LICENCE_PROJECTED_SNAPSHOT_PATHS.includes(entry.path)) {
        if (entry.projection !== undefined) {
            return `${entry.path}: snapshot must pin the whole file`;
        }
        return snapshot.fileDigests[entry.path] === entry.sha256 ? undefined : `${entry.path}: snapshot drifted`;
    }
    if (entry.projection !== licenceInputProjectionKind(entry.path)) {
        return `${entry.path}: snapshot must pin the ${licenceInputProjectionKind(entry.path)} projection`;
    }
    return snapshot.snapshotProjectionDigests[entry.path] === entry.sha256
        ? undefined
        : `${entry.path}: snapshot drifted`;
}
