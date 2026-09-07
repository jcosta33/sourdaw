import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';
import { releaseAllActiveNotes } from '../releaseAllActiveNotes';
import { activeNotes, channelToNote } from '../state';

import type { WebMidiInstrumentStrip } from '../engineStripAccess';

function make_strip() {
    const fermenter_note_off = vi.fn<(note: number, sampleFrame?: number) => void>();
    const grand_boule_note_off = vi.fn<(note: number, sampleFrame?: number, releaseVelocity?: number) => void>();
    const levain_note_off = vi.fn<(note: number, sampleFrame?: number) => void>();
    const toaster_note_off = vi.fn<(pad: number, sampleFrame?: number) => void>();

    const strip: WebMidiInstrumentStrip = {
        deviceNodes: [
            { deviceId: 'ferm-1', type: 'fermenter', fermenterControls: { noteOff: fermenter_note_off } },
            { deviceId: 'gb-1', type: 'grand-boule', grandBouleControls: { noteOff: grand_boule_note_off } },
            { deviceId: 'lev-1', type: 'levain', levainControls: { noteOff: levain_note_off } },
            { deviceId: 'toast-1', type: 'toaster', toasterControls: { noteOff: toaster_note_off } },
        ],
    };

    return { strip, fermenter_note_off, grand_boule_note_off, levain_note_off, toaster_note_off };
}

describe('releaseAllActiveNotes', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
    });

    it('releases a held Fermenter voice rather than only forgetting it', () => {
        const { strip, fermenter_note_off } = make_strip();
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            fermenterDeviceId: 'ferm-1',
        });

        releaseAllActiveNotes({ getCurrentTime: () => 1, getTrackStrip: () => strip, releaseNativeNote: () => {} });

        expect(fermenter_note_off).toHaveBeenCalledWith(60);
    });

    it('releases a held Grand Boule voice', () => {
        const { strip, grand_boule_note_off } = make_strip();
        activeNotes.set(createWebMidiNoteKey(0, 48), {
            channel: 0,
            note: 48,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            grandBouleDeviceId: 'gb-1',
        });

        releaseAllActiveNotes({ getCurrentTime: () => 1, getTrackStrip: () => strip, releaseNativeNote: () => {} });

        expect(grand_boule_note_off).toHaveBeenCalledWith(48);
    });

    it('releases a held Levain voice', () => {
        const { strip, levain_note_off } = make_strip();
        activeNotes.set(createWebMidiNoteKey(0, 72), {
            channel: 0,
            note: 72,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            levainDeviceId: 'lev-1',
        });

        releaseAllActiveNotes({ getCurrentTime: () => 1, getTrackStrip: () => strip, releaseNativeNote: () => {} });

        expect(levain_note_off).toHaveBeenCalledWith(72);
    });

    it('releases the Toaster pad the note-on actually routed to', () => {
        const { strip, toaster_note_off } = make_strip();
        activeNotes.set(createWebMidiNoteKey(0, 36), {
            channel: 0,
            note: 36,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            toasterRoute: { deviceId: 'toast-1', pad: 3 },
        });

        releaseAllActiveNotes({ getCurrentTime: () => 1, getTrackStrip: () => strip, releaseNativeNote: () => {} });

        expect(toaster_note_off).toHaveBeenCalledWith(3);
    });

    it('releases a natively voiced note on the body that voiced it', () => {
        const release_native_note = vi.fn();
        activeNotes.set(createWebMidiNoteKey(2, 64), {
            channel: 2,
            note: 64,
            trackId: 'track-1',
            instrumentTrackId: 'parent-1',
            nativeDeviceId: 'plug-1',
            startTime: 0,
            startBeat: 0,
        });

        releaseAllActiveNotes({ getTrackStrip: () => undefined, releaseNativeNote: release_native_note });

        expect(release_native_note).toHaveBeenCalledExactlyOnceWith({
            trackId: 'parent-1',
            deviceId: 'plug-1',
            note: 64,
            channel: 2,
        });
        expect(activeNotes.size).toBe(0);
    });

    it('omits the member channel so every voice at the pitch is released, not just one', () => {
        // MD-2 made note-off channel-optional precisely so a forced release
        // cannot strand a second voice sounding the same pitch on another
        // member channel or a ringing release tail.
        const { strip, fermenter_note_off } = make_strip();
        activeNotes.set(createWebMidiNoteKey(2, 60), {
            channel: 2,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            fermenterDeviceId: 'ferm-1',
        });

        releaseAllActiveNotes({ getCurrentTime: () => 1, getTrackStrip: () => strip, releaseNativeNote: () => {} });

        expect(fermenter_note_off.mock.calls[0]).toEqual([60]);
    });

    it('fades and stops a raw oscillator voice', () => {
        const set_target = vi.fn<(target: number, startTime: number, timeConstant: number) => void>();
        const stop = vi.fn<(when: number) => void>();
        activeNotes.set(createWebMidiNoteKey(0, 64), {
            channel: 0,
            note: 64,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            osc: {
                stop,
                _env: { gain: { setTargetAtTime: set_target } },
            } as unknown as OscillatorNode & { _env?: GainNode },
        });

        releaseAllActiveNotes({ getCurrentTime: () => 4, getTrackStrip: () => undefined, releaseNativeNote: () => {} });

        expect(set_target).toHaveBeenCalledWith(0, 4, 0.005);
        expect(stop).toHaveBeenCalledWith(4.02);
    });

    it('releases every held note, not only the first', () => {
        const { strip, fermenter_note_off } = make_strip();
        for (const note of [60, 62, 64]) {
            activeNotes.set(createWebMidiNoteKey(0, note), {
                channel: 0,
                note,
                trackId: 'track-1',
                instrumentTrackId: 'track-1',
                startTime: 0,
                startBeat: 0,
                fermenterDeviceId: 'ferm-1',
            });
        }

        releaseAllActiveNotes({ getCurrentTime: () => 1, getTrackStrip: () => strip, releaseNativeNote: () => {} });

        expect(fermenter_note_off.mock.calls.map(([note]) => note)).toEqual([60, 62, 64]);
    });

    it('empties both live maps so a later real note-off cannot double-release', () => {
        const { strip } = make_strip();
        const key = createWebMidiNoteKey(2, 60);
        activeNotes.set(key, {
            channel: 2,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            fermenterDeviceId: 'ferm-1',
        });
        channelToNote.set(2, key);

        releaseAllActiveNotes({ getCurrentTime: () => 1, getTrackStrip: () => strip, releaseNativeNote: () => {} });

        expect(activeNotes.size).toBe(0);
        expect(channelToNote.size).toBe(0);
    });

    it('survives a note whose instrument strip is already gone', () => {
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'removed-track',
            startTime: 0,
            startBeat: 0,
            fermenterDeviceId: 'ferm-1',
            grandBouleDeviceId: 'gb-1',
            levainDeviceId: 'lev-1',
        });

        expect(() =>
            releaseAllActiveNotes({
                getCurrentTime: () => 1,
                getTrackStrip: () => undefined,
                releaseNativeNote: () => {},
            })
        ).not.toThrow();
        expect(activeNotes.size).toBe(0);
    });

    it('swallows a stop on an oscillator that already ended', () => {
        activeNotes.set(createWebMidiNoteKey(0, 64), {
            channel: 0,
            note: 64,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            osc: {
                stop: () => {
                    throw new Error('already stopped');
                },
            } as unknown as OscillatorNode & { _env?: GainNode },
        });

        expect(() =>
            releaseAllActiveNotes({
                getCurrentTime: () => 1,
                getTrackStrip: () => undefined,
                releaseNativeNote: () => {},
            })
        ).not.toThrow();
        expect(activeNotes.size).toBe(0);
    });
});
