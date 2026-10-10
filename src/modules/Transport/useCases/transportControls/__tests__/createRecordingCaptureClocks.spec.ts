import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playheadClockRef } from '../../../stores/playheadClockRef';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import { createRecordingCaptureClocks } from '../createRecordingCaptureClocks';
import { recordingLifecycle } from '../recordingLifecycle';

describe('recording capture occurrence clocks', () => {
    const context = { currentTime: 50 };
    let clocks: ReturnType<typeof createRecordingCaptureClocks>;

    beforeEach(() => {
        context.currentTime = 50;
        schedulerSession.pendingSeam = null;
        playheadClockRef.beat = 10;
        clocks = createRecordingCaptureClocks(context, (beat) => beat / 2);
        clocks.register();
    });

    afterEach(() => {
        clocks.dispose();
        schedulerSession.pendingSeam = null;
    });

    it('keeps the latest sounded occurrence through multiple wraps before reader admission', () => {
        const clock = clocks.create('track');
        recordingLifecycle.observeCaptureClock(8, 51.1, true);
        recordingLifecycle.observeCaptureClock(8, 53.1, true);
        recordingLifecycle.observeCaptureClock(8.2, 53.2, false);
        expect(clock.relocation).toEqual({ songSeconds: 4, contextSeconds: 53.1 });
        clock.setReader(() => ({ status: 'pending' }));
        recordingLifecycle.observeCaptureClock(8.3, 53.25, false);
        clock.setReader(() => ({ status: 'captured', contextSeconds: 53.2 }));
        recordingLifecycle.observeCaptureClock(8.4, 53.3, false);
        expect(clock.frozen).toBe(true);
        expect(clock.relocation).toEqual({ songSeconds: 4, contextSeconds: 53.1 });
        recordingLifecycle.observeCaptureClock(8, 55.1, true);
        expect(clock.relocation).toEqual({ songSeconds: 4, contextSeconds: 53.1 });
    });

    it.each([
        { firstFrame: 52.9, occurrence: 51.1 },
        { firstFrame: 53.1, occurrence: 53.1 },
        { firstFrame: 53.2, occurrence: 53.1 },
    ])('resolves a torn publication to its sample-zero occurrence at $firstFrame', ({ firstFrame, occurrence }) => {
        const clock = clocks.create('track');
        recordingLifecycle.observeCaptureClock(8, 51.1, true);
        clock.setReader(() => ({ status: 'retry' }));
        recordingLifecycle.observeCaptureClock(8, 53.1, true);
        expect(clock.relocation?.contextSeconds).toBe(51.1);
        expect(clock.pendingRelocations.map((epoch) => epoch.contextSeconds)).toEqual([53.1]);
        clock.freeze(firstFrame);
        expect(clock.relocation?.contextSeconds).toBe(occurrence);
        expect(clock.pendingRelocations).toEqual([]);
    });

    it('keeps sample zero before a seam in its original occurrence', () => {
        const clock = clocks.create('track');
        clock.setReader(() => ({ status: 'captured', contextSeconds: 51 }));
        recordingLifecycle.observeCaptureClock(8, 51.1, true);
        expect(clock.frozen).toBe(true);
        expect(clock.relocation).toBeNull();
    });

    it.each(['captured', 'retry', 'unadmitted'] as const)(
        'keeps a %s first frame before a tempo epoch in its previous occurrence',
        (publication) => {
            const clock = clocks.create('track');
            recordingLifecycle.observeCaptureClock(8, 49, true);
            if (publication === 'captured') {
                clock.setReader(() => ({ status: 'captured', contextSeconds: 50.05 }));
            } else if (publication === 'retry') {
                clock.setReader(() => ({ status: 'retry' }));
            }
            recordingLifecycle.observeCaptureClock(10, 50, true, 50.1);
            clock.freeze(50.05);
            expect(clock.relocation).toEqual({ songSeconds: 4, contextSeconds: 49 });
        }
    );

    it('uses the placement anchor for a torn first frame after the tempo epoch becomes effective', () => {
        const clock = clocks.create('track');
        recordingLifecycle.observeCaptureClock(8, 49, true);
        clock.setReader(() => ({ status: 'retry' }));
        recordingLifecycle.observeCaptureClock(10, 50, true, 50.1);
        clock.freeze(50.15);
        expect(clock.relocation).toMatchObject({ songSeconds: 5, contextSeconds: 50 });
    });

    it('uses a stable pending publication to retain the next sounded occurrence', () => {
        const clock = clocks.create('track');
        clock.setReader(() => ({ status: 'pending' }));
        recordingLifecycle.observeCaptureClock(8, 51.1, true);
        recordingLifecycle.observeCaptureClock(8, 53.1, true);
        clock.freeze(53.2);
        expect(clock.relocation).toEqual({ songSeconds: 4, contextSeconds: 53.1 });
    });

    it.each([
        { firstFrame: 51.125, contextSeconds: 51.1, songSeconds: 4 },
        { firstFrame: 51.2, contextSeconds: 51.16, songSeconds: 8.12 },
        { firstFrame: 51.4, contextSeconds: 51.3, songSeconds: 4.13 },
    ])(
        'selects the latest eligible sounded epoch from a torn publication at $firstFrame',
        ({ firstFrame, contextSeconds, songSeconds }) => {
            const clock = clocks.create('track');
            recordingLifecycle.observeCaptureClock(11.8, 51, true);
            clock.setReader(() => ({ status: 'retry' }));
            recordingLifecycle.observeCaptureClock(8, 51.1, true, undefined, 4);
            recordingLifecycle.observeCaptureClock(8.12, 51.16, true, 51.16, 8.12);
            recordingLifecycle.observeCaptureClock(8.26, 51.3, true, 51.3, 4.13);
            clock.freeze(firstFrame);
            expect(clock.relocation).toMatchObject({ contextSeconds, songSeconds });
        }
    );

    it.each([
        { stopTime: 51, occurrence: null },
        { stopTime: 51.1, occurrence: { songSeconds: 4, contextSeconds: 51.1 } },
    ])('admits only a seam already sounded when Stop occurs at $stopTime', ({ stopTime, occurrence }) => {
        const clock = clocks.create('track');
        schedulerSession.pendingSeam = {
            seamAudioTime: 51.1,
            destinationBeat: 8,
            anchorAudioTime: 51,
            anchorPosition: 11.8,
        };
        context.currentTime = stopTime;
        recordingLifecycle.endRecording();
        expect(clock.relocation).toEqual(occurrence);
        const lateReader = vi.fn(() => ({ status: 'pending' as const }));
        clock.setReader(lateReader);
        recordingLifecycle.observeCaptureClock(8, 53.1, true);
        expect(clock.readStart).toBeNull();
        expect(lateReader).not.toHaveBeenCalled();
        clock.freeze(51.2);
        expect(clock.relocation).toEqual(occurrence);
    });

    it('rejects a removed owner reader while the successor retains its own occurrence', () => {
        const oldClock = clocks.create('track');
        clocks.create('other');
        recordingLifecycle.observeCaptureClock(8, 51.1, true);
        clocks.remove('track');
        const successor = clocks.create('track');
        const staleReader = vi.fn(() => ({ status: 'captured' as const, contextSeconds: 60 }));
        oldClock.setReader(staleReader);
        successor.setReader(() => ({ status: 'pending' }));
        recordingLifecycle.observeCaptureClock(8, 53.1, true);
        successor.freeze(53.2);
        expect(staleReader).not.toHaveBeenCalled();
        expect(oldClock.readStart).toBeNull();
        expect(oldClock.relocation?.contextSeconds).toBe(51.1);
        expect(successor.relocation?.contextSeconds).toBe(53.1);
    });

    it('does not reattach a late producer reader after its sample-zero epoch freezes', () => {
        const clock = clocks.create('track');
        clock.freeze(50.2);
        const lateReader = vi.fn(() => ({ status: 'pending' as const }));
        clock.setReader(lateReader);
        expect(clock.readStart).toBeNull();
        recordingLifecycle.observeCaptureClock(8, 51.1, true);
        expect(lateReader).not.toHaveBeenCalled();
    });

    it('does not adopt a cancelled seam even after its former sounding time', () => {
        const clock = clocks.create('track');
        schedulerSession.pendingSeam = {
            seamAudioTime: 51.1,
            destinationBeat: 8,
            anchorAudioTime: 51,
            anchorPosition: 11.8,
        };
        schedulerSession.pendingSeam = null;
        context.currentTime = 51.2;
        recordingLifecycle.endRecording();
        clock.freeze(51.2);
        expect(clock.relocation).toBeNull();
    });
});
