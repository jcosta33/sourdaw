import { getAutomationRecordingDependencies } from './getAutomationRecordingDependencies';

/**
 * Convert a raw transport beat into the lane's beat space.
 *
 * Recorded points are stamped in latency-compensated beats: what is *heard* at
 * raw beat B was scheduled at `B - offset`, so the lane must carry the
 * compensated beat or replay drifts by the round trip. Every timestamp a
 * recording pass commits — gesture samples and the transport stop/loop
 * boundary alike — must cross through this one conversion, or the boundary and
 * the samples land in different spaces and the held interval breaks at its
 * seam.
 */
export function latencyCompensatedBeat(rawBeat: number, trackId: string, tempo: number): number {
    const deps = getAutomationRecordingDependencies();
    const ctx = deps.getAudioContext();
    const totalHardwareLatencySec = (ctx.baseLatency || 0) + (ctx.outputLatency || 0);
    const trackLatencySec = deps.getCompensationDelay(trackId);
    const offsetBeats = ((totalHardwareLatencySec + trackLatencySec) * tempo) / 60;
    return Math.max(0, rawBeat - offsetBeats);
}
