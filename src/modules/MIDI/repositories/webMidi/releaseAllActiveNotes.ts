import { releaseActiveToasterNote } from './releaseActiveToasterNote';
import { activeNotes, channelToNote } from './state';

import type { GetWebMidiTrackStrip, WebMidiInstrumentStrip } from './engineStripAccess';
import type { ActiveNoteData } from '../../models/WebMidiTypes';

type ReleaseAllActiveNotesInput = {
    /**
     * Audio-context clock for the oscillator fade. Optional: the teardown path
     * has no engine handle, and omitting it schedules the fade and stop in the
     * past, which the Web Audio API applies immediately — the abrupt stop
     * teardown already did.
     */
    getCurrentTime?: () => number;
    getTrackStrip: GetWebMidiTrackStrip;
};

/** Fade applied to a raw oscillator voice before it is stopped, in seconds. */
const OSCILLATOR_FADE_SECONDS = 0.005;
/** Stop offset after the fade, so the ramp completes before the node ends. */
const OSCILLATOR_STOP_DELAY_SECONDS = 0.02;

function findDeviceNode(strip: WebMidiInstrumentStrip | undefined, deviceId: string) {
    return strip?.deviceNodes.find((candidate) => candidate.deviceId === deviceId);
}

function releaseOne(noteData: ActiveNoteData, input: ReleaseAllActiveNotesInput): void {
    releaseActiveToasterNote(noteData, input.getTrackStrip);

    // Every device the note-on recorded gets its own release. Note-off is
    // channel-optional by design (audit MD-2): omitting the member channel
    // releases *every* voice at that pitch, which is exactly what a panic
    // wants — a channel-unaware forced release cannot strand a voice.
    if (noteData.fermenterDeviceId) {
        const strip = input.getTrackStrip(noteData.instrumentTrackId);
        findDeviceNode(strip, noteData.fermenterDeviceId)?.fermenterControls?.noteOff(noteData.note);
    }

    if (noteData.grandBouleDeviceId) {
        const strip = input.getTrackStrip(noteData.instrumentTrackId);
        findDeviceNode(strip, noteData.grandBouleDeviceId)?.grandBouleControls?.noteOff(noteData.note);
    }

    if (noteData.levainDeviceId) {
        const strip = input.getTrackStrip(noteData.instrumentTrackId);
        findDeviceNode(strip, noteData.levainDeviceId)?.levainControls?.noteOff(noteData.note);
    }

    if (!noteData.osc) {
        return;
    }
    const now = input.getCurrentTime?.() ?? 0;
    if (noteData.osc._env) {
        noteData.osc._env.gain.setTargetAtTime(0, now, OSCILLATOR_FADE_SECONDS);
    }
    try {
        noteData.osc.stop(now + OSCILLATOR_STOP_DELAY_SECONDS);
    } catch {
        // Already stopped.
    }
}

/**
 * Release every note the live Web MIDI map is still holding, then empty the map
 * (audit MD-6).
 *
 * This is the one place live-note release is written. The reset, teardown and
 * user-panic paths all call it rather than each keeping its own list of which
 * device kinds to release — two of those lists had already drifted, releasing
 * Toaster pads and raw oscillators but silently leaking every Fermenter, Grand
 * Boule and Levain voice, which then had no owner at all because the map was
 * cleared underneath them.
 */
export function releaseAllActiveNotes(input: ReleaseAllActiveNotesInput): void {
    for (const noteData of activeNotes.values()) {
        releaseOne(noteData, input);
    }
    activeNotes.clear();
    channelToNote.clear();
}
