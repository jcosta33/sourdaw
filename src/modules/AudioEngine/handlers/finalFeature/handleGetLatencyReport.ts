import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getLatencyReport } from '../../useCases/latencyCompensation/compensation/getLatencyReport';

export const handleGetLatencyReport = createHandler<'getLatencyReport'>({
    execute: () => {
        const report = getLatencyReport();
        const maxMs = report.maxLatencyMs.toFixed(1);
        // The two context terms are disjoint successive segments of the output path
        // (Web Audio API §1.2.2): `baseLatency` runs from AudioDestinationNode to the
        // audio subsystem, `outputLatency` from the host accepting a buffer to the
        // device playing its first sample. Latency is additive, so what the user hears
        // is the sum — this line used to report the first term alone. `Max:` stays
        // separate because it is plug-in delay compensation *inside* the graph, a
        // different quantity that would be double-counted if folded in here.
        const baseMs = report.contextBaseLatencyMs.toFixed(1);
        const deviceMs = report.contextOutputLatencyMs.toFixed(1);
        const outputMs = (report.contextBaseLatencyMs + report.contextOutputLatencyMs).toFixed(1);
        const summary = `Max: ${maxMs}ms, Output: ${outputMs}ms (context ${baseMs}ms + device ${deviceMs}ms)`;
        const trackLines = report.tracks
            .filter((track) => track.deviceLatencyMs > 0)
            .map((track) => `${track.trackId}: ${track.totalLatencyMs.toFixed(1)}ms`)
            .join(', ');
        const detail = trackLines ? `${summary} — ${trackLines}` : `${summary} — no device latency`;
        notifyUser(`Latency Report: ${detail}`);
    },
    describe: () => ({ label: 'Get latency report' }),
    undoable: false,
});
