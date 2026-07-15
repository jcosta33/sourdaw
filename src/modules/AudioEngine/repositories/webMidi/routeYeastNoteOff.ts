/**
 * Route Yeast-rack Note Off events to the live instrument on their origin track strip.
 *
 * Extracted from `handleNoteOff` so the same device-node delivery is reused by
 * (a) the live-keyboard Note Off path and (b) the processor-removal panic path
 * (`yeast.notesOff` app event — emitted by Yeast's `removeYeastProcessor` use
 * case and by the Worker runtime when a processor is removed mid-playback, whose
 * captured Note Offs would otherwise be discarded, hanging the note).
 */

import { audioEngine } from '../createWebAudioEngine';

import { resolveInstrumentTrack } from './resolveInstrumentTrack';
import { routeYeastNoteOffToInstrument } from './routeYeastNoteOffToInstrument';

import type { TrackStoreState } from '#/modules/Arrangement/stores';

/**
 * Route a batch of Note Off note numbers to their explicit originating track's
 * instrument. Resolves the instrument track and strip once, then delivers each
 * note. A no-op when the origin track is missing or has no supported instrument.
 */
export function routeYeastNoteOffsForTargetTrack(
    trackId: string,
    notes: readonly number[],
    deps: {
        getTrackStoreState: () => TrackStoreState | null;
        emitGrandBouleEvent: (deviceId: string, midiNote: number) => void;
    }
): void {
    if (notes.length === 0) {
        return;
    }
    const instrumentTrack = resolveInstrumentTrack(deps.getTrackStoreState(), trackId);
    if (!instrumentTrack) {
        return;
    }
    const strip = audioEngine.getTrackStrip(instrumentTrack.id);
    for (const note of notes) {
        // Panic / processor-removal path: these are forced offs with no MIDI
        // release-velocity byte, so the release dynamic is 0.
        routeYeastNoteOffToInstrument(instrumentTrack, strip, note, 0, deps.emitGrandBouleEvent);
    }
}
