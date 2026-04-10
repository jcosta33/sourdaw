import { createHandler } from '#/helpers/createHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { getLatencyReport } from '#/modules/AudioEngine';

export const handleGetLatencyReport = createHandler<'getLatencyReport'>({
    execute: () => {
        const report = getLatencyReport();
        const maxMs = report.maxLatencyMs.toFixed(1);
        const baseMs = report.contextBaseLatencyMs.toFixed(1);
        const trackLines = report.tracks
            .filter((t) => t.deviceLatencyMs > 0)
            .map((t) => `${t.trackId}: ${t.totalLatencyMs.toFixed(1)}ms`)
            .join(', ');
        const detail = trackLines
            ? `Max: ${maxMs}ms, Base: ${baseMs}ms — ${trackLines}`
            : `Max: ${maxMs}ms, Base: ${baseMs}ms — no device latency`;
        notifyUser(`Latency Report: ${detail}`);
    },
    describe: () => ({ label: 'Get latency report' }),
    undoable: false,
});
