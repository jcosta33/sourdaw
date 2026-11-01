let documentIdentityEpoch = 0;

/** The repository advances this only when the installed document identity changes. */
export function advanceDocumentIdentityEpoch(): void {
    documentIdentityEpoch += 1;
}

export function readDocumentIdentityEpoch(): number {
    return documentIdentityEpoch;
}

/** Stable across edits within the same document lineage. */
export function captureProjectIdentity(): string {
    return JSON.stringify({ documentIdentityEpoch: readDocumentIdentityEpoch() });
}
