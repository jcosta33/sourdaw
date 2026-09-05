import { releasedStripReportSink, type ReleasedStripReportSink } from './releasedStripReportSink';

/**
 * Wire the sink an unload's released strip reports forward to.
 *
 * The slot this writes is runtime wiring, not project truth: it names which
 * foreign mirror gets told about a native chain release, and that choice
 * belongs to whichever process assembled the app, not to PluginHost. Only the
 * composition root calls this, once, at startup — `unloadPlugin` never picks
 * its own sink, so the module stays ignorant of who, if anyone, is listening.
 */
export function registerReleasedStripReportSink(sink: ReleasedStripReportSink): void {
    releasedStripReportSink.current = sink;
}
