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

type RoutedYeastNoteOff = {
    channel: number;
    note: number;
};

/**
 * Route a batch of channel-complete Note Off identities to their explicit originating track's
 * instrument. Resolves the instrument track and strip once, then delivers each
 * note. A no-op when the origin track is missing or has no supported instrument.
 */
export function routeYeastNoteOffsForTargetTrack(
    trackId: string,
    noteOffs: readonly RoutedYeastNoteOff[],
    deps: {
        getTrackStoreState: () => TrackStoreState | null;
        emitGrandBouleEvent: (deviceId: string, midiNote: number) => void;
    }
): void {
    if (noteOffs.length === 0) {
        return;
    }
    const instrumentTrack = resolveInstrumentTrack(deps.getTrackStoreState(), trackId);
    if (!instrumentTrack) {
        return;
    }
    const strip = audioEngine.getTrackStrip(instrumentTrack.id);
    const routedNotesByChannel = new Map<number, Set<number>>();
    for (const { channel, note } of noteOffs) {
        const routedNotes = routedNotesByChannel.get(channel) ?? new Set<number>();
        if (routedNotes.has(note)) {
            continue;
        }
        routedNotes.add(note);
        routedNotesByChannel.set(channel, routedNotes);
        // Panic / processor-removal path: these are forced offs with no MIDI
        // release-velocity byte, so the release dynamic is 0.
        routeYeastNoteOffToInstrument(instrumentTrack, strip, note, 0, deps.emitGrandBouleEvent);
    }
}
