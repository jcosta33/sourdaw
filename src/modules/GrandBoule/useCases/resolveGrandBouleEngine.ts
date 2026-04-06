/**
 * Resolve the Grand Boule engine handle for a given device id.
 *
 * Looks up the real AudioWorklet-backed controls from the audio engine strip.
 * Falls back to a disconnected stub if the engine is not ready yet.
 */

import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases/engineAccess';
import {
    createDisconnectedGrandBouleEngineHandle,
    type GrandBouleEngineHandle,
} from '../repositories/grandBouleEngineHandle';

type ResolveGrandBouleEngineInput = {
    deviceId: string;
};

export type ResolvedGrandBouleEngine = GrandBouleEngineHandle;

export const resolveGrandBouleEngine = (
    input: ResolveGrandBouleEngineInput,
): ResolvedGrandBouleEngine => {
    const track = getAllTracks().find((t) =>
        t.devices.some((d) => d.id === input.deviceId),
    );
    if (track === undefined) {
        return createDisconnectedGrandBouleEngineHandle();
    }

    const strip = ensureTrackStrip(track.id);
    const dn = strip.deviceNodes.find((d) => d.grandBouleControls?.ready);
    if (dn?.grandBouleControls === undefined) {
        return createDisconnectedGrandBouleEngineHandle();
    }

    const controls = dn.grandBouleControls;
    return {
        noteOn: (i) => controls.noteOn(i.midiNote, i.velocity),
        noteOff: (i) => controls.noteOff(i.midiNote),
        noteOnMidi2: (i) =>
            controls.noteOnMidi2(i.midiNote, i.velocity16bit, i.pitchOffsetQ24),
        setParam: (i) => controls.setParam(i.name, i.value),
        setSustain: (i) => controls.setSustain(i.position),
        setUnaCorda: (i) => controls.setUnaCorda(i.engaged),
        setSostenuto: (i) => controls.setSostenuto(i.engaged),
        loadAttackClip: () => {},
        allNotesOff: () => controls.allNotesOff(),
        isReady: () => true,
    };
};
