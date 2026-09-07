/**
 * One strip's chain as an unload left it, as the sink this use case forwards
 * to reads it.
 *
 * The repository's own DTO for the native reply's `reports` entries stays
 * inside `repositories/pluginBridge/unloadPlugin`, like every other bridge
 * shape; `forwardReleasedStripReports` maps onto this one, field by field.
 */
export type ReleasedStripReport = {
    kind: 'track' | 'bus';
    id: string;
    deviceIds: readonly string[];
};

/** Where an unload's released strip reports go, once forwarded. */
export type ReleasedStripReportSink = (reports: readonly ReleasedStripReport[]) => void;

/**
 * The one slot `registerReleasedStripReportSink` writes and
 * `forwardReleasedStripReports` reads.
 *
 * A single slot rather than a set of observers: unlike a plugin's own
 * parameter edits, which any number of unrelated observers may watch, there is
 * one narrowing to perform — AudioEngine's own native chain mirror — not a
 * broadcast.
 *
 * A holder object rather than a bare mutable export, mirroring
 * `externalPluginParameterEditObservers`'s non-function export: ephemeral
 * runtime state that the composition root wires at startup, never project
 * truth, so it lives beside the use cases that read and write it rather than
 * behind a `services/` file that could never depend on either.
 */
export const releasedStripReportSink: { current: ReleasedStripReportSink | null } = { current: null };
