import { describe, it, expect, vi } from 'vitest';

import { schedulePendingSuspends } from '../schedulePendingSuspends';
import { type PendingWorkletEvent } from '../types';

describe('schedulePendingSuspends', () => {
    it('should not call any controls when there are no events', () => {
        const offlineCtx = {
            sampleRate: 48_000,
        } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [], 10);
        // No assertions needed other than it doesn't crash
    });

    it('should call noteOn with correct sampleFrame for a non-toaster note-on', () => {
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
        const offlineCtx = {
            sampleRate: 48_000,
        } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [evt], 10);

        expect(noteOn).toHaveBeenCalledWith({ noteOrPad: 60, velocity: 0.75, sampleFrame: 48_000 });
        expect(noteOff).not.toHaveBeenCalled();
    });

    it('delivers a Levain articulation on the same sample-accurate note-on request', () => {
        const noteOn = vi.fn();
        const instrumentControls = { noteOn, noteOff: vi.fn() };
        const evt: PendingWorkletEvent = {
            time: 0.25,
            type: 'on',
            pitch: 62,
            velocity: 96,
            articulationId: 8,
            instrumentControls,
            isToaster: false,
            toasterPadIndex: -1,
        };

        schedulePendingSuspends({ sampleRate: 48_000 } as OfflineAudioContext, [evt], 10);

        expect(noteOn).toHaveBeenCalledWith({
            noteOrPad: 62,
            velocity: 96,
            sampleFrame: 12_000,
            articulationId: 8,
        });
    });

    it('addresses both halves of an MPE note to its member channel', () => {
        // A recorded note carries the member channel it was played on, and live
        // playback passes it to `noteOff` so releasing one note cannot silence a
        // different note sounding the same pitch on another channel. A bounce
        // that drops it releases every voice at that pitch, so the export and
        // the session disagree on an overlapping unison.
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        const instrumentControls = { noteOn, noteOff };
        const onEvent: PendingWorkletEvent = {
            time: 0.5,
            type: 'on',
            pitch: 64,
            velocity: 90,
            channel: 3,
            instrumentControls,
            isToaster: false,
            toasterPadIndex: -1,
        };
        const offEvent: PendingWorkletEvent = { ...onEvent, time: 1, type: 'off', velocity: 0 };

        schedulePendingSuspends({ sampleRate: 48_000 } as OfflineAudioContext, [onEvent, offEvent], 10);

        expect(noteOn).toHaveBeenCalledWith({ noteOrPad: 64, velocity: 90, sampleFrame: 24_000, channel: 3 });
        expect(noteOff).toHaveBeenCalledWith({ noteOrPad: 64, sampleFrame: 48_000, channel: 3 });
    });

    it('carries the member channel alongside a Levain articulation', () => {
        const noteOn = vi.fn();
        const evt: PendingWorkletEvent = {
            time: 0.25,
            type: 'on',
            pitch: 62,
            velocity: 96,
            channel: 5,
            articulationId: 8,
            instrumentControls: { noteOn, noteOff: vi.fn() },
            isToaster: false,
            toasterPadIndex: -1,
        };

        schedulePendingSuspends({ sampleRate: 48_000 } as OfflineAudioContext, [evt], 10);

        expect(noteOn).toHaveBeenCalledWith({
            noteOrPad: 62,
            velocity: 96,
            sampleFrame: 12_000,
            channel: 5,
            articulationId: 8,
        });
    });

    it('should use pad + midi note + sampleFrame for Toaster note-on when pad index is set', () => {
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
        const offlineCtx = {
            sampleRate: 48_000,
        } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [evt], 10);

        expect(noteOn).toHaveBeenCalledWith({ noteOrPad: 4, velocity: 0.9, midiNote: 60, sampleFrame: 24_000 });
    });

    it('resolves legacy Toaster events through the canonical GM pad banks', () => {
        const noteOn = vi.fn();
        const noteOff = vi.fn();
        const instrumentControls = { noteOn, noteOff };
        const lowBank: PendingWorkletEvent = {
            time: 0.5,
            type: 'on',
            pitch: 36,
            velocity: 0.9,
            instrumentControls,
            isToaster: true,
            toasterPadIndex: -1,
        };
        const highBank: PendingWorkletEvent = { ...lowBank, time: 1, pitch: 60 };
        const invalid: PendingWorkletEvent = { ...lowBank, time: 1.5, pitch: 52 };
        const offlineCtx = {
            sampleRate: 48_000,
        } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [invalid, highBank, lowBank], 10);

        expect(noteOn).toHaveBeenNthCalledWith(1, { noteOrPad: 0, velocity: 0.9, midiNote: 36, sampleFrame: 24_000 });
        expect(noteOn).toHaveBeenNthCalledWith(2, { noteOrPad: 0, velocity: 0.9, midiNote: 60, sampleFrame: 48_000 });
        expect(noteOn).toHaveBeenCalledTimes(2);
        expect(noteOff).not.toHaveBeenCalled();
    });

    it('should sort events correctly (off before on at same time)', () => {
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
        const offlineCtx = {
            sampleRate: 48_000,
        } as unknown as OfflineAudioContext;

        schedulePendingSuspends(offlineCtx, [onEvt, offEvt], 10);

        expect(noteOff).toHaveBeenCalledWith({ noteOrPad: 60, sampleFrame: 48_000 });
        expect(noteOn).toHaveBeenCalledWith({ noteOrPad: 60, velocity: 0.5, sampleFrame: 48_000 });

        // Check order
        const offCall = noteOff.mock.invocationCallOrder[0]!;
        const onCall = noteOn.mock.invocationCallOrder[0]!;
        expect(offCall).toBeLessThan(onCall);
    });
});
