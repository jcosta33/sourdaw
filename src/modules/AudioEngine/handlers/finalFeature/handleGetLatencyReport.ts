import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { getLatencyReport } from '../../useCases/latencyCompensation/compensation/getLatencyReport';

export const handleGetLatencyReport = createHandler<'getLatencyReport'>({
    execute: () => {
        const report = getLatencyReport();
        const maxMs = report.maxLatencyMs.toFixed(1);
        const baseMs = report.contextBaseLatencyMs.toFixed(1);
        const trackLines = report.tracks
            .filter((track) => track.deviceLatencyMs > 0)
            .map((track) => `${track.trackId}: ${track.totalLatencyMs.toFixed(1)}ms`)
            .join(', ');
        const detail = trackLines
            ? `Max: ${maxMs}ms, Base: ${baseMs}ms — ${trackLines}`
            : `Max: ${maxMs}ms, Base: ${baseMs}ms — no device latency`;
        notifyUser(`Latency Report: ${detail}`);
    },
    describe: () => ({ label: 'Get latency report' }),
    undoable: false,
});
