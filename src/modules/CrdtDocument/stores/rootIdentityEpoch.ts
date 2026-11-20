let rootIdentityEpoch = 0;

/** The repository advances this only when it installs a different active root document. */
export function advanceRootIdentityEpoch(): void {
    rootIdentityEpoch += 1;
}

export function readRootIdentityEpoch(): number {
    return rootIdentityEpoch;
}

/**
 * The runtime identity of the installed active root document: it changes when the project is
 * replaced (a new, loaded or joined project, a branch switch), never when a merge only adds child
 * documents. Meaningful only for comparisons within this runtime; it is not a persisted identifier.
 */
export function captureProjectRootIdentity(): string {
    return JSON.stringify({ rootIdentityEpoch: readRootIdentityEpoch() });
}
