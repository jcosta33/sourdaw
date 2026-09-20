import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { type AutomationLane } from '../../../models/AutomationViewTypes';
import { createOfflineDeviceNode, type OfflineDeviceNode } from '../../deviceNodeFactory';
import { WebAudioDeviceStrategy } from '../../deviceStrategy/WebAudioDeviceStrategy';

import { scheduleTrackAutomationFixture } from './scheduleTrackAutomationFixture';

/**
 * The drop guard on a frame-addressed ceiling write decides reachability with
 * the frame the `OfflineAudioContext` will actually suspend at — the scheduler's
 * rounded request frame, quantised DOWN to the render-quantum boundary — not
 * with the raw request frame (#4465).
 */
describe('scheduleTrackAutomation — curve-write reachability (#4465)', () => {
    function makeLimiterNode(): OfflineDeviceNode {
        const node = createOfflineDeviceNode({
            context: asBaseAudioContext(createMockAudioContext()),
            deviceType: 'builtin-limiter',
        });
        if (!node) {
            throw new Error('expected a builtin-limiter offline node');
        }
        return node;
    }

    /**
     * A ceiling lane whose last point lands at 2 s and whose slew is therefore
     * still gliding at the render end: `compileAutomationEvents` emits its final
     * slewed sample on the render-end frame, so the write the guard judges is the
     * render-end write.
     */
    function glidingCeilingLane(): AutomationLane {
        return {
            id: 'lane-1',
            trackId: 'track-1',
            parameterId: 'device-1:lim-ceiling',
            parameterName: 'Ceiling',
            minValue: -60,
            maxValue: 12,
            points: [
                { beat: 0, value: -0.3, curve: 'linear', tension: 0 },
                { beat: 4, value: -5, curve: 'linear', tension: 0 },
            ],
            enabled: true,
        };
    }

    function webAudioEntry(deviceId: string, deviceType: string, node: OfflineDeviceNode) {
        return { deviceId, deviceType, contributesAudio: true, strategy: new WebAudioDeviceStrategy(node, deviceType) };
    }

    /** Records every `(time, call)` so a case can read the times the guard admitted. */
    function makeFrameScheduler() {
        const calls: { time: number | undefined; run: () => void }[] = [];
        return {
            calls,
            scheduleFrame: (time: number | undefined, call: () => void): void => {
                calls.push({ time, run: call });
            },
        };
    }

    function scheduleCeilingLane(durationSeconds: number) {
        const node = makeLimiterNode();
        const { calls, scheduleFrame } = makeFrameScheduler();
        scheduleTrackAutomationFixture({
            lanes: [glidingCeilingLane()],
            trackId: 'track-1',
            trackGainNode: { gain: { value: 0 } as unknown as AudioParam },
            trackPanNode: { pan: { value: 0 } as unknown as AudioParam },
            deviceEntries: [webAudioEntry('device-1', 'builtin-limiter', node)],
            durationSeconds,
            defaultTempo: 120,
            changes: [],
            sampleRate: 1_000,
            scheduleFrame,
        });
        return { calls, times: calls.map((call) => call.time) as number[] };
    }

    it('schedules the render-end write when the rounded request frame reaches renderFrames but the quantised suspend frame stays inside', () => {
        // 2.0006 s at 1 kHz is a 2001-frame render (ceil). The render-end write
        // rounds to request frame 2001 — `>= renderFrames` — but quantises down
        // to frame 1920, inside the render, so the context accepts the suspend.
        const { times } = scheduleCeilingLane(2.0006);

        expect(times.at(-1)).toBeCloseTo(2.0006, 9);
    });

    it('still schedules the render-end write when the rounded request frame stays a frame inside the render', () => {
        // 2.0004 s is also a 2001-frame render; its render-end write rounds to
        // request frame 2000, already inside, and quantising it cannot push it
        // out. This is the side of the asymmetry the old guard already kept.
        const { times } = scheduleCeilingLane(2.0004);

        expect(times.at(-1)).toBeCloseTo(2.0004, 9);
    });

    it('still drops a write whose quantised suspend frame reaches or passes the render', () => {
        // A single-point lane shifted 2.5 s past a 2.0006 s render: the write
        // rounds to request frame 2500 and quantises to 2432, `>=` the 2001-frame
        // render, so it must not be scheduled.
        const node = makeLimiterNode();
        const { calls, scheduleFrame } = makeFrameScheduler();
        scheduleTrackAutomationFixture({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    parameterId: 'device-1:lim-ceiling',
                    parameterName: 'Ceiling',
                    minValue: -60,
                    maxValue: 12,
                    points: [{ beat: 0, value: -1, curve: 'linear', tension: 0 }],
                    enabled: true,
                },
            ],
            trackId: 'track-1',
            trackGainNode: { gain: { value: 0 } as unknown as AudioParam },
            trackPanNode: { pan: { value: 0 } as unknown as AudioParam },
            deviceEntries: [webAudioEntry('device-1', 'builtin-limiter', node)],
            durationSeconds: 2.0006,
            defaultTempo: 120,
            changes: [],
            sampleRate: 1_000,
            compensationDelaySec: 2.5,
            scheduleFrame,
        });

        // Only the region-start seed (re-anchored at 0) lands; the 2.5 s write
        // is dropped before it reaches the scheduler.
        expect(calls.map((call) => call.time)).toEqual([0]);
    });
});
