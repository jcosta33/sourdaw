import { releasedStripReportSink, type ReleasedStripReport } from './releasedStripReportSink';

import type { PluginUnloadStripReport } from '../../repositories/pluginBridge/unloadPlugin';

function toReleasedStripReport(report: PluginUnloadStripReport): ReleasedStripReport {
    return { kind: report.kind, id: report.id, deviceIds: report.deviceIds };
}

/** Forward reports to the registered sink. Does nothing when none is registered. */
export function forwardReleasedStripReports(reports: readonly PluginUnloadStripReport[]): void {
    releasedStripReportSink.current?.(reports.map(toReleasedStripReport));
}
