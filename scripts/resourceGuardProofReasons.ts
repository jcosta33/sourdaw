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
