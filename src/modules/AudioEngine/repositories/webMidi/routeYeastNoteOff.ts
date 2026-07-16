/**
 * Route Yeast-rack Note Off events to the live instrument on their origin track strip.
 *
 * Extracted from `handleNoteOff` so the same device-node delivery is reused by
 * (a) the live-keyboard Note Off path and (b) the processor-removal panic path.
 * The use-case layer resolves the originating Arrangement track before this
 * repository port is called.
 */

import { audioEngine } from '../createWebAudioEngine';

import { routeYeastNoteOffToInstrument } from './routeYeastNoteOffToInstrument';

import type { WebMidiInstrumentTrack } from './instrumentTrackPort';

type RoutedYeastNoteOff = {
    channel: number;
    note: number;
};

/**
 * Route a batch of channel-complete Note Off identities to the resolved
 * instrument track. Resolves the live strip once, then delivers each note. A
 * no-op when the origin track is missing or has no supported instrument.
 */
export function routeYeastNoteOffsForTargetTrack(
    instrumentTrack: WebMidiInstrumentTrack | null,
    noteOffs: readonly RoutedYeastNoteOff[],
    deps: {
        emitGrandBouleEvent: (deviceId: string, midiNote: number) => void;
    }
): void {
    if (noteOffs.length === 0 || !instrumentTrack) {
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
