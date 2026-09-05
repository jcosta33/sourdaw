import { releasedStripReportSink } from './releasedStripReportSink';

import type { ReleasedStripReport } from '../../repositories/pluginBridge/unloadPlugin';

/** Forward reports to the registered sink. Does nothing when none is registered. */
export function forwardReleasedStripReports(reports: readonly ReleasedStripReport[]): void {
    releasedStripReportSink.current?.(reports);
}
