import { describe, expect, it } from 'vitest';

import {
    classifySimplePlaybackControl,
    hasPlaybackStatsRefreshed,
    summarizeCdpMetrics,
    summarizePlaybackStatsWindow,
    summarizeRuntimeWindow,
    waitForPlaybackStatsRefresh,
    type CdpMetricSample,
} from '../myceliumPlaybackEvidence';
import type { RuntimeSnapshot } from '../myceliumPerformanceEvidence';

function snapshot(input: {
    averageLatency?: number;
    detectedUnderrunBlocks: number;
    isPlaying?: boolean;
    maximumLatency?: number;
    messagesReceived?: number;
    minimumLatency?: number;
    silentFrames: number;
    ticksSettled?: number;
    totalDuration: number;
    underrunDuration: number;
    underrunEvents: number;
}): RuntimeSnapshot {
    return {
        capturedAtMs: 0,
        audio: {
            playback: {
                ...input,
                averageLatency: input.averageLatency ?? 0.012,
                minimumLatency: input.minimumLatency ?? 0.008,
                maximumLatency: input.maximumLatency ?? 0.02,
            },
        },
        health: {
            dropouts: {
                detectedUnderrunBlocks: input.detectedUnderrunBlocks,
                silentFrames: input.silentFrames,
                lastUnderrunAtFrame: 9_600,
            },
        },
        livePlayheadPosition: 0,
        projectDirty: false,
        probeDurationMs: {},
        readiness: {},
        scheduler: { messagesReceived: input.messagesReceived ?? 8, ticksSettled: input.ticksSettled ?? 7 },
        transport: { isPlaying: input.isPlaying ?? false },
        visibilityState: 'visible',
    };
}

function cdpSample(value: number, gaugeValue = value): CdpMetricSample {
    return {
        elapsedMs: value,
        values: {
            Timestamp: value,
            LayoutCount: value,
            LayoutDuration: value,
            RecalcStyleCount: value,
            RecalcStyleDuration: value,
            ScriptDuration: value,
            TaskDuration: value,
            Documents: gaugeValue,
            Frames: gaugeValue,
            JSEventListeners: gaugeValue,
            JSHeapTotalSize: gaugeValue,
            JSHeapUsedSize: gaugeValue,
            Nodes: gaugeValue,
        },
    };
}

describe('Mycelium playback evidence', () => {
    it('waits for a fresh Chrome playback-stats publication before taking the baseline', () => {
        const stale = snapshot({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            totalDuration: 10,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        const refreshed = snapshot({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            totalDuration: 11,
            underrunDuration: 0.25,
            underrunEvents: 47,
        });

        expect(hasPlaybackStatsRefreshed({ candidate: stale, previous: stale })).toBe(false);
        expect(hasPlaybackStatsRefreshed({ candidate: refreshed, previous: stale })).toBe(true);
    });

    it('polls until playback statistics advance and returns the published snapshot', async () => {
        const stale = snapshot({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            totalDuration: 10,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        const refreshed = snapshot({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            totalDuration: 11,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        const events: string[] = [];
        let elapsedMs = 0;
        let reads = 0;

        const result = await waitForPlaybackStatsRefresh({
            now: () => elapsedMs,
            pollIntervalMs: 50,
            previous: stale,
            readSnapshot: () => {
                events.push('read');
                reads += 1;
                return Promise.resolve(reads === 1 ? stale : refreshed);
            },
            timeoutMs: 200,
            wait: (milliseconds) => {
                events.push(`wait:${milliseconds}`);
                elapsedMs += milliseconds;
                return Promise.resolve();
            },
        });

        expect(result).toBe(refreshed);
        expect(events).toEqual(['wait:50', 'read', 'wait:50', 'read']);
    });

    it('does not accept a fresh endpoint captured after transport stopped', async () => {
        const previous = snapshot({
            detectedUnderrunBlocks: 0,
            isPlaying: true,
            silentFrames: 0,
            totalDuration: 10,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        const stopped = snapshot({
            detectedUnderrunBlocks: 0,
            isPlaying: false,
            silentFrames: 0,
            totalDuration: 11,
            underrunDuration: 1,
            underrunEvents: 1,
        });
        const playing = snapshot({
            detectedUnderrunBlocks: 0,
            isPlaying: true,
            silentFrames: 0,
            totalDuration: 12,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        let elapsedMs = 0;
        const candidates = [stopped, playing];

        const result = await waitForPlaybackStatsRefresh({
            now: () => elapsedMs,
            pollIntervalMs: 50,
            previous,
            readSnapshot: () => Promise.resolve(candidates.shift() ?? playing),
            requiredIsPlaying: true,
            timeoutMs: 200,
            wait: (milliseconds) => {
                elapsedMs += milliseconds;
                return Promise.resolve();
            },
        });

        expect(result).toBe(playing);
    });

    it('fails when playback statistics do not publish before the deadline', async () => {
        const stale = snapshot({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            totalDuration: 10,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        let elapsedMs = 0;

        await expect(
            waitForPlaybackStatsRefresh({
                now: () => elapsedMs,
                pollIntervalMs: 50,
                previous: stale,
                readSnapshot: () => Promise.resolve(stale),
                timeoutMs: 100,
                wait: (milliseconds) => {
                    elapsedMs += milliseconds;
                    return Promise.resolve();
                },
            })
        ).rejects.toThrow('did not publish a fresh snapshot');
    });

    it('propagates playback-statistics read failures', async () => {
        const stale = snapshot({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            totalDuration: 10,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        let elapsedMs = 0;

        await expect(
            waitForPlaybackStatsRefresh({
                now: () => elapsedMs,
                previous: stale,
                readSnapshot: () => Promise.reject(new Error('page closed')),
                timeoutMs: 100,
                wait: (milliseconds) => {
                    elapsedMs += milliseconds;
                    return Promise.resolve();
                },
            })
        ).rejects.toThrow('page closed');
    });

    it('computes cumulative playback and worker-underrun deltas', () => {
        const before = snapshot({
            detectedUnderrunBlocks: 2,
            silentFrames: 256,
            totalDuration: 10,
            underrunDuration: 0.125,
            underrunEvents: 3,
        });
        const after = snapshot({
            detectedUnderrunBlocks: 5,
            silentFrames: 640,
            totalDuration: 25,
            underrunDuration: 0.375,
            underrunEvents: 7,
        });

        expect(summarizeRuntimeWindow({ after, before })).toMatchObject({
            playback: {
                totalDuration: 15,
                underrunDuration: 0.25,
                underrunEvents: 4,
                underrunRatio: 0.25 / 15,
                underrunEventsPerSecond: 4 / 15,
                averageUnderrunDuration: 0.25 / 4,
            },
            detectedDropouts: {
                detectedUnderrunBlocks: 3,
                silentFrames: 384,
                lastUnderrunAtFrameBefore: 9_600,
                lastUnderrunAtFrameAfter: 9_600,
            },
            scheduler: { messagesReceived: 8, ticksSettled: 7 },
        });
    });

    it('summarizes post-stop playback without requiring scheduler activity', () => {
        const before = snapshot({
            detectedUnderrunBlocks: 0,
            messagesReceived: 0,
            silentFrames: 0,
            ticksSettled: 0,
            totalDuration: 10,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        const after = snapshot({
            detectedUnderrunBlocks: 0,
            messagesReceived: 0,
            silentFrames: 0,
            ticksSettled: 0,
            totalDuration: 11,
            underrunDuration: 0,
            underrunEvents: 0,
        });

        const playbackWindow = summarizePlaybackStatsWindow({ after, before });

        expect(playbackWindow.totalDuration).toBe(1);
        expect(classifySimplePlaybackControl({ playbackWindow, realtimeRatio: 1, visibilityState: 'visible' })).toBe(
            'clean'
        );
        expect(classifySimplePlaybackControl({ playbackWindow, realtimeRatio: 0.5, visibilityState: 'visible' })).toBe(
            'contaminated'
        );
        expect(classifySimplePlaybackControl({ playbackWindow, realtimeRatio: 1.5, visibilityState: 'visible' })).toBe(
            'contaminated'
        );
        expect(classifySimplePlaybackControl({ playbackWindow, realtimeRatio: 1, visibilityState: 'hidden' })).toBe(
            'contaminated'
        );

        expect(
            classifySimplePlaybackControl({
                playbackWindow: { ...playbackWindow, underrunDuration: 0.01, underrunEvents: 1 },
                realtimeRatio: 1,
                visibilityState: 'visible',
            })
        ).toBe('contaminated');
    });

    it.each([
        [{ totalDuration: 2, underrunDuration: 0, underrunEvents: 0.5 }, 'underrunEvents must be integers'],
        [{ totalDuration: 2, underrunDuration: 2, underrunEvents: 1 }, 'underrunDuration cannot exceed totalDuration'],
        [
            {
                averageLatency: 0.005,
                maximumLatency: 0.02,
                minimumLatency: 0.01,
                totalDuration: 2,
                underrunDuration: 0,
                underrunEvents: 0,
            },
            'latency statistics are inconsistent',
        ],
    ])('rejects impossible playback evidence %#', (afterOverrides, message) => {
        const before = snapshot({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            totalDuration: 1,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        const after = snapshot({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            ...afterOverrides,
        });

        expect(() => summarizePlaybackStatsWindow({ after, before })).toThrow(message);
    });

    it('summarizes every cumulative, gauge-endpoint, and high-water CDP metric', () => {
        expect(summarizeCdpMetrics([cdpSample(1), cdpSample(2, 4), cdpSample(3)])).toEqual({
            cumulativeDeltas: {
                LayoutCount: 2,
                LayoutDuration: 2,
                RecalcStyleCount: 2,
                RecalcStyleDuration: 2,
                ScriptDuration: 2,
                TaskDuration: 2,
            },
            gaugeBaseline: {
                Documents: 1,
                Frames: 1,
                JSEventListeners: 1,
                JSHeapTotalSize: 1,
                JSHeapUsedSize: 1,
                Nodes: 1,
            },
            gaugeDelta: {
                Documents: 2,
                Frames: 2,
                JSEventListeners: 2,
                JSHeapTotalSize: 2,
                JSHeapUsedSize: 2,
                Nodes: 2,
            },
            gaugeFinal: {
                Documents: 3,
                Frames: 3,
                JSEventListeners: 3,
                JSHeapTotalSize: 3,
                JSHeapUsedSize: 3,
                Nodes: 3,
            },
            gaugeHighWater: {
                Documents: 4,
                Frames: 4,
                JSEventListeners: 4,
                JSHeapTotalSize: 4,
                JSHeapUsedSize: 4,
                Nodes: 4,
            },
        });
    });

    it('rejects incomplete or decreasing CDP windows', () => {
        expect(() => summarizeCdpMetrics([cdpSample(1)])).toThrow('baseline and final sample');
        expect(() => summarizeCdpMetrics([cdpSample(2), cdpSample(1)])).toThrow('CDP LayoutCount decreased');
    });

    it.each([
        [{ messagesReceived: 0, ticksSettled: 1 }, 'received no scheduler messages'],
        [{ messagesReceived: 1, ticksSettled: 0 }, 'settled no scheduler ticks'],
    ])('rejects inactive scheduler evidence', (scheduler, message) => {
        const before = snapshot({
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            totalDuration: 1,
            underrunDuration: 0,
            underrunEvents: 0,
        });
        const after = snapshot({
            ...scheduler,
            detectedUnderrunBlocks: 0,
            silentFrames: 0,
            totalDuration: 2,
            underrunDuration: 0,
            underrunEvents: 0,
        });

        expect(() => summarizeRuntimeWindow({ after, before })).toThrow(message);
    });

    it.each([
        ['totalDuration', 'Audio playback totalDuration decreased'],
        ['underrunDuration', 'Audio playback underrunDuration decreased'],
        ['underrunEvents', 'Audio playback underrunEvents decreased'],
        ['detectedUnderrunBlocks', 'Detected dropout blocks decreased'],
        ['silentFrames', 'Detected dropout silent frames decreased'],
    ] as const)('rejects a decreasing cumulative %s counter', (name, message) => {
        const counters = {
            detectedUnderrunBlocks: 2,
            silentFrames: 2,
            totalDuration: 2,
            underrunDuration: 2,
            underrunEvents: 2,
        };
        const before = snapshot(counters);
        const after = snapshot({ ...counters, totalDuration: 3, [name]: 1 });

        expect(() => summarizeRuntimeWindow({ after, before })).toThrow(message);
    });
});
