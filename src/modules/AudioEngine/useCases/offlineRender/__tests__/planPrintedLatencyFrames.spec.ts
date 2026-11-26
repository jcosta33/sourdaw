import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_OFFLINE_FRAMES } from '../../../repositories/clampRenderFrameCount';
import { type LatencyCompensationInput } from '../../latencyCompensation/compensation/LatencyCompensationInput';
import { planPrintedLatencyFrames } from '../planPrintedLatencyFrames';

const SAMPLE_RATE = 44_100;

/** A session 250 ms deep through `deepest`; `plain` is held back that long and carries no latency of its own. */
function latencyReading(): LatencyCompensationInput {
    const track = (id: string, deviceIds: string[]) => ({
        id,
        outputId: 'hw_out',
        sends: [],
        devices: deviceIds.map((deviceId) => ({
            id: deviceId,
            name: deviceId,
            type: 'knead',
            bypassed: false,
            parameterValues: {},
        })),
    });
    return {
        tracks: [track('plain', []), track('deepest', ['deepest-device'])],
        routes: [],
        deviceLatencyMs: new Map([['deepest-device', 250]]),
    };
}

describe('planPrintedLatencyFrames', () => {
    let onWarning: ReturnType<typeof vi.fn<(message: string) => void>>;

    beforeEach(() => {
        onWarning = vi.fn<(message: string) => void>();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('is the frames of the delay the strip carries, read from the given device latencies', () => {
        const frames = planPrintedLatencyFrames({
            trackId: 'plain',
            latency: latencyReading(),
            sampleRate: SAMPLE_RATE,
            baseFrameCount: 88_200,
            onWarning,
        });

        expect(frames).toBe(Math.round(0.25 * SAMPLE_RATE));
        expect(onWarning).not.toHaveBeenCalled();
    });

    it('is zero for a strip that is already the deepest of a session with no latency', () => {
        const frames = planPrintedLatencyFrames({
            trackId: 'plain',
            latency: { tracks: [], routes: [], deviceLatencyMs: new Map() },
            sampleRate: SAMPLE_RATE,
            baseFrameCount: 88_200,
            onWarning,
        });

        expect(frames).toBe(0);
    });

    it('cuts a delay that does not fit under the renderer cap to the room left, and says so', () => {
        const frames = planPrintedLatencyFrames({
            trackId: 'plain',
            latency: latencyReading(),
            sampleRate: SAMPLE_RATE,
            baseFrameCount: MAX_OFFLINE_FRAMES - 1_000,
            onWarning,
        });

        expect(frames).toBe(1_000);
        expect(onWarning).toHaveBeenCalledOnce();
    });
});
