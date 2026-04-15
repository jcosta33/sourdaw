import { describe, it, expect, vi } from 'vitest';
import { schedulePendingSuspends } from '../schedulePendingSuspends';
import { type PendingWorkletEvent } from '../types';

describe('schedulePendingSuspends', () => {
    it('should not call suspend when there are no events', () => {
        const suspend = vi.fn().mockReturnValue(Promise.resolve());
        const resume = vi.fn();
        const offlineCtx = {
            sampleRate: 48_000,
            suspend,
            resume,
        } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [], 10);

        expect(suspend).not.toHaveBeenCalled();
        expect(resume).not.toHaveBeenCalled();
    });

    it('should call suspend once, then noteOn and resume for a non-toaster note-on', async () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        const instrumentControls = { noteOn, noteOff };
        const evt: PendingWorkletEvent = {
            time: 1,
            type: 'on',
            pitch: 60,
            velocity: 0.75,
            instrumentControls,
            isToaster: false,
            toasterPadIndex: -1,
        };
        const suspend = vi.fn().mockReturnValue(Promise.resolve());
        const resume = vi.fn();
        const offlineCtx = {
            sampleRate: 48_000,
            suspend,
            resume,
        } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [evt], 10);

        expect(suspend).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        expect(noteOn).toHaveBeenCalledWith(60, 0.75);
        expect(noteOff).not.toHaveBeenCalled();
        expect(resume).toHaveBeenCalledTimes(1);
    });

    it('should use pad + midi note for Toaster note-on when pad index is set', async () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        const instrumentControls = { noteOn, noteOff };
        const evt: PendingWorkletEvent = {
            time: 0.5,
            type: 'on',
            pitch: 60,
            velocity: 0.9,
            instrumentControls,
            isToaster: true,
            toasterPadIndex: 4,
        };
        const suspend = vi.fn().mockReturnValue(Promise.resolve());
        const resume = vi.fn();
        const offlineCtx = {
            sampleRate: 48_000,
            suspend,
            resume,
        } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [evt], 10);

        await Promise.resolve();
        expect(noteOn).toHaveBeenCalledWith(4, 0.9, 60);
        expect(resume).toHaveBeenCalledTimes(1);
    });

    it('should batch multiple events at the same quantized time into one suspend', async () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        const instrumentControls = { noteOn, noteOff };
        const offEvt: PendingWorkletEvent = {
            time: 1,
            type: 'off',
            pitch: 60,
            velocity: 0,
            instrumentControls,
            isToaster: false,
            toasterPadIndex: -1,
        };
        const onEvt: PendingWorkletEvent = {
            time: 1,
            type: 'on',
            pitch: 60,
            velocity: 0.5,
            instrumentControls,
            isToaster: false,
            toasterPadIndex: -1,
        };
        const suspend = vi.fn().mockReturnValue(Promise.resolve());
        const resume = vi.fn();
        const offlineCtx = {
            sampleRate: 48_000,
            suspend,
            resume,
        } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [onEvt, offEvt], 10);

        expect(suspend).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        expect(noteOff).toHaveBeenCalledWith(60);
        expect(noteOn).toHaveBeenCalledWith(60, 0.5);
        expect(resume).toHaveBeenCalledTimes(1);
    });
});
