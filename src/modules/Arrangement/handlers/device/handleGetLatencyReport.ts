import { getLatencyReport } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleGetLatencyReport = createHandler<'getLatencyReport'>({
    execute: () => {
        const report = getLatencyReport();
        const maxMs = report.maxLatencyMs.toFixed(1);
        const baseMs = report.contextBaseLatencyMs.toFixed(1);
        const trackLines = report.tracks
            .filter((time) => time.deviceLatencyMs > 0)
            .map((time) => `${time.trackId}: ${time.totalLatencyMs.toFixed(1)}ms`)
            .join(', ');
        const detail = trackLines
            ? `Max: ${maxMs}ms, Base: ${baseMs}ms — ${trackLines}`
            : `Max: ${maxMs}ms, Base: ${baseMs}ms — no device latency`;
        notifyUser(`Latency Report: ${detail}`);
    },
    describe: () => ({ label: 'Get latency report' }),
    undoable: false,
});
