// Only diagnostics that say the census could not finish a pass right now. They clear on a later
// pass, so a retained directory reaches reclamation. Everything else that leaves a census
// unknown (storage that is not private, denied inspection, an unusable lsof, a changed uid) is
// stable: it would keep the directory unreclaimed forever, so it must stay a failure.
const transientProofReasons: readonly RegExp[] = [
    /^lsof-live-pid-missing:/,
    /^lsof-missed-pid-exited:/,
    /^lsof-missed-pid-heir:/,
    /^lsof-fields-unusable:descriptor-type-missing$/,
    /^file-census-time-bound$/,
    /^process-users-unavailable$/,
    /^process-users-unusable$/,
    /^proc-time-bound$/,
    /^proc-live-pid-uninspected:/,
];

export function areTransientProofReasons(reasons: readonly string[]): boolean {
    return (
        reasons.length > 0 && reasons.every((reason) => transientProofReasons.some((pattern) => pattern.test(reason)))
    );
}

type CensusVerdict = 'alive' | 'dead' | 'unknown';

export function storageReleaseFailure(
    error: unknown,
    verdict: CensusVerdict | undefined
): {
    errno: string;
    syscall: string;
    census: CensusVerdict | 'unobserved';
} {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const syscall = typeof error === 'object' && error !== null && 'syscall' in error ? error.syscall : undefined;
    return {
        errno: typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'unknown',
        syscall:
            typeof syscall === 'string' &&
            /^(?:open|close|read|write|lstat|stat|fstat|rename|unlink|rmdir|scandir|mkdir|readlink|realpath)$/.test(
                syscall
            )
                ? syscall
                : 'unknown',
        census: verdict ?? 'unobserved',
    };
}

function sessionProofPredicate(reason: string | undefined): string | undefined {
    return reason !== undefined &&
        /^session-(?:process-census-unavailable|reference-unavailable|platform-unsupported|identity-unknown:pid=[1-9]\d{0,15}:status=(?:reused|start-unavailable|probe-unavailable|unclassified)(?::errno=(?:[A-Z0-9_]{1,32}|unknown))?)$/.test(
            reason
        )
        ? reason
        : undefined;
}

export function describeStorageProofFailure(
    obstruction: string | undefined,
    diagnostic: string | undefined,
    verdict: CensusVerdict | undefined,
    reasons: readonly string[],
    releaseFailure: ReturnType<typeof storageReleaseFailure> | undefined
): string | undefined {
    const firstPredicate = sessionProofPredicate(diagnostic);
    const finalPredicate = reasons.map(sessionProofPredicate).find((reason) => reason !== undefined);
    if (firstPredicate === undefined && finalPredicate === undefined && releaseFailure === undefined) {
        return undefined;
    }
    let firstObstruction: { verdict: CensusVerdict; predicate: string | undefined } | null = null;
    if (obstruction !== undefined) {
        firstObstruction = {
            verdict: obstruction.startsWith('alive') ? 'alive' : 'unknown',
            predicate: firstPredicate,
        };
    }
    return JSON.stringify({
        firstObstruction,
        finalObservation: {
            verdict: verdict ?? 'unobserved',
            predicate: finalPredicate,
        },
        releaseFailure,
    });
}
