/**
 * Where an unload's released strip reports go, once the composition root
 * wires it up.
 *
 * A single slot rather than a set of observers: unlike a plugin's own
 * parameter edits, which any number of unrelated observers may watch, there is
 * one narrowing to perform — AudioEngine's own native chain mirror — not a
 * broadcast.
 *
 * Lives in `services/` rather than `useCases/`: a use-case file exports
 * exactly one function (`sourdaw/no-multiple-function-exports`), and
 * registering a sink plus forwarding to it are a paired register/read of one
 * private slot, not two independent use cases.
 * `useCases/pluginLifecycle/registerReleasedStripReportSink.ts` re-exports the
 * registration entry point so the module barrel can publish it without
 * reaching outside `useCases/`.
 *
 * Declares its own `ReleasedStripReport` shape rather than importing the
 * repository's: `services-must-stay-pure` forbids a service from depending on
 * `repositories/`, even for a type-only edge, so the two shapes are kept in
 * sync by hand instead of shared.
 */
type ReleasedStripReport = {
    kind: 'track' | 'bus';
    id: string;
    deviceIds: readonly string[];
};

let releasedStripReportSink: ((reports: readonly ReleasedStripReport[]) => void) | undefined;

/** Wire the sink an unload's released strip reports forward to. */
export function registerReleasedStripReportSink(sink: (reports: readonly ReleasedStripReport[]) => void): void {
    releasedStripReportSink = sink;
}

/** Forward reports to the registered sink. Does nothing when none is registered. */
export function forwardReleasedStripReports(reports: readonly ReleasedStripReport[]): void {
    releasedStripReportSink?.(reports);
}
