/**
 * Whether the native engine diagnostics surface has reported itself absent.
 *
 * `engine_rt_diagnostics` is the one command a standing status bar polls every
 * second. In a desktop shell whose addon never loaded, the router answers every
 * call with the native-host-absent refusal forever — the host cannot appear
 * without a process restart — so the first such refusal retires the surface and
 * later polls answer the not-running web shape instead of issuing a doomed
 * bridge call each second.
 *
 * It lives here rather than beside the repository for the same reason
 * `engineDiagnosticsReadFailureLatch` does: a spec must be able to clear it, or
 * one retired surface carries into the next test and silences the bridge calls
 * it makes.
 */
let retired = false;

/** Record that the native diagnostics surface answered "the native host is not available". */
export function retireEngineDiagnosticsNativeSurface(): void {
    retired = true;
}

/** True once the native diagnostics surface has reported itself absent. */
export function isEngineDiagnosticsNativeSurfaceRetired(): boolean {
    return retired;
}

/** Re-arm the surface. Production code never calls this: the host cannot return within a process. */
export function resetEngineDiagnosticsNativeSurface(): void {
    retired = false;
}
