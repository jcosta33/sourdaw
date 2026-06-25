/**
 * Route Yeast-rack Note Off events to the live instrument on a track strip.
 *
 * Extracted from `handleNoteOff` so the same device-node delivery is reused by
 * (a) the live-keyboard Note Off path and (b) the processor-removal panic path
 * (`yeast.notesOff` app event — emitted by Yeast's `removeYeastProcessor` use
 * case and by the worklet node when a processor is removed mid-playback, whose
 * captured Note Offs would otherwise be discarded, hanging the note).
 */

import { audioEngine } from '../createWebAudioEngine';

import { getTargetTrackId } from './state';

import type { TrackStoreState } from '#/modules/Arrangement/stores';
import type { TrackChannelStrip } from '../../models/AudioEngineState';

type Track = NonNullable<TrackStoreState['tracks']>[number];

/**
 * Resolve the instrument-bearing track for the current MIDI target track.
 *
 * Mirrors the resolution `handleNoteOff` performs: a child track whose parent
 * carries a `toaster` device routes to the parent. Returns null when there is
 * no target track or the store is empty.
 */
export function resolveInstrumentTrack(trackState: TrackStoreState | null): Track | null {
    const targetTrackId = getTargetTrackId();
    if (!targetTrackId || !trackState) {
        return null;
    }
    const targetTrack = trackState.tracks.find((time) => time.id === targetTrackId);
    if (!targetTrack) {
        return null;
    }
    if (targetTrack.parentId) {
        const parent = trackState.tracks.find((time) => time.id === targetTrack.parentId);
        if (parent?.devices.some((data) => data.type === 'toaster')) {
            return parent;
        }
    }
    return targetTrack;
}

/**
 * Deliver one Note Off to whichever instrument device node the given track
 * hosts (fermenter / grand-boule / levain). The first matching device wins,
 * matching the priority `handleNoteOff` uses. A no-op if the track has no
 * supported instrument or the strip/control is not ready.
 *
 * `releaseVelocity` (normalized 0..1) is the MIDI note-off velocity; it is
 * forwarded to the Grand Boule control so the release dynamic survives the
 * rack-routed path.
 */
export function routeYeastNoteOffToInstrument(
    instrumentTrack: Track,
    strip: TrackChannelStrip | undefined,
    note: number,
    releaseVelocity: number,
    emitGrandBouleEvent: (deviceId: string, midiNote: number) => void
): void {
    const fDev = instrumentTrack.devices.find((data) => data.type === 'fermenter');
    if (fDev) {
        const dn = strip?.deviceNodes.find((data) => data.type === 'fermenter');
        dn?.fermenterControls?.noteOff(note);
        return;
    }
    const gbDev = instrumentTrack.devices.find((data) => data.type === 'grand-boule');
    if (gbDev) {
        const dn = strip?.deviceNodes.find((data) => data.type === 'grand-boule');
        dn?.grandBouleControls?.noteOff(note, undefined, releaseVelocity);
        emitGrandBouleEvent(gbDev.id, note);
        return;
    }
    const lDev = instrumentTrack.devices.find((data) => data.type === 'levain');
    if (lDev) {
        const dn = strip?.deviceNodes.find((data) => data.type === 'levain');
        dn?.levainControls?.noteOff(note);
    }
}

/**
 * Route a batch of Note Off note numbers (e.g. the offs a removed Yeast
 * processor left hanging) to the current target track's instrument. Resolves
 * the instrument track and strip once, then delivers each note. A no-op when
 * there is no target track or no supported instrument — the same guard the
 * live path applies.
 */
export function routeYeastNoteOffsForTargetTrack(
    notes: readonly number[],
    deps: {
        getTrackStoreState: () => TrackStoreState | null;
        emitGrandBouleEvent: (deviceId: string, midiNote: number) => void;
    }
): void {
    if (notes.length === 0) {
        return;
    }
    const instrumentTrack = resolveInstrumentTrack(deps.getTrackStoreState());
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
