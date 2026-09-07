import { getTrackStrip } from '../engineAccess/getTrackStrip';

export async function importScoringTuning(
    trackId: string,
    deviceId: string,
    format: 'scala' | 'tun',
    text: string
): Promise<{ ok: boolean; name?: string }> {
    const strip = getTrackStrip(trackId);
    const node = strip?.deviceNodes.find((d) => d.deviceId === deviceId);
    if (!node?.scoringControls) {
        return { ok: false };
    }
    return format === 'scala' ? node.scoringControls.importScala(text) : node.scoringControls.importTun(text);
}
