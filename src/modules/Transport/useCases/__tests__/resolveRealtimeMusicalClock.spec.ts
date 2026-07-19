import { beforeEach, describe, expect, it } from 'vitest';

import { playheadPositionRef } from '../../stores/playheadPositionRef';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { transportStore } from '../../stores/transportStore';
import { schedulerSession } from '../playheadScheduler/schedulerSession';
import { resolveRealtimeMusicalClock } from '../resolveRealtimeMusicalClock';
import { defaultTransportState } from '../transportQueries/helpers';

describe('resolveRealtimeMusicalClock', () => {
    beforeEach(() => {
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 0 });
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
        playheadPositionRef.current = 4;
        schedulerSession.accumulatedPosition = 4;
        schedulerSession.lastTickTime = 10;
    });

    it('preserves the AudioContext sample frame that anchors the projected PPQ position', () => {
        const sampleTime = 10.25 * 48_000;

        expect(resolveRealtimeMusicalClock({ sampleTime, sampleRate: 48_000 })).toEqual(
            expect.objectContaining({ sampleTime })
        );
    });

    it('derives bar, beat, and meter from the time-signature map', () => {
        playheadPositionRef.current = 8.75;
        schedulerSession.accumulatedPosition = 8.75;
        timeSignatureMapStore.set({
            changes: [
                { id: 'three-four', beat: 0, numerator: 3, denominator: 4 },
                { id: 'seven-eight', beat: 6, numerator: 7, denominator: 8 },
            ],
        });

        expect(resolveRealtimeMusicalClock({ sampleTime: 10 * 48_000, sampleRate: 48_000 })).toEqual(
            expect.objectContaining({
                barIndex: 2,
                beatInBar: 5.5,
                timeSigNum: 7,
                timeSigDen: 8,
            })
        );
    });

    it('projects an input sample from the high-frequency playhead anchor', () => {
        expect(resolveRealtimeMusicalClock({ sampleTime: 10.25 * 48_000, sampleRate: 48_000 })).toEqual(
            expect.objectContaining({ ppqPosition: 4.5, bpm: 120 })
        );
    });

    it('integrates through a tempo boundary before resolving the event tempo', () => {
        playheadPositionRef.current = 3.5;
        schedulerSession.accumulatedPosition = 3.5;
        tempoMapStore.set({
            changes: [
                { id: 'before', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'after', beat: 4, tempo: 240, curve: 'instant' },
            ],
        });

        const clock = resolveRealtimeMusicalClock({ sampleTime: 10.375 * 48_000, sampleRate: 48_000 });

        expect(clock?.ppqPosition).toBeCloseTo(4.5, 10);
        expect(clock?.bpm).toBe(240);
    });
});
