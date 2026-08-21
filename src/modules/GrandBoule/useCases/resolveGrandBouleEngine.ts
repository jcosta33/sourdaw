import { getAllTracks } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip, getAudioSampleRate } from '#/modules/AudioEngine/useCases';

import {
    createDisconnectedGrandBouleEngineHandle,
    type GrandBouleEngineHandle,
} from '../repositories/grandBouleEngineHandle';

type GrandBouleResolverDevice = {
    id: string;
};

type GrandBouleResolverTrack = {
    id: string;
    devices: readonly GrandBouleResolverDevice[];
};

type ResolveGrandBouleEngineInput = {
    deviceId: string;
    /**
     * Render-time callers pass the subscribed track list so
     * the React Compiler can memoize this derivation against the track
     * store. Non-render callers can omit this; we fall back to a live read.
     */
    tracks?: readonly GrandBouleResolverTrack[];
};

export type ResolvedGrandBouleEngine = GrandBouleEngineHandle;

export function resolveGrandBouleEngine(input: ResolveGrandBouleEngineInput): ResolvedGrandBouleEngine {
    const tracks = input.tracks ?? getAllTracks();
    const track = tracks.find((candidateTrack) =>
        candidateTrack.devices.some((device) => device.id === input.deviceId)
    );
    if (track === undefined) {
        return createDisconnectedGrandBouleEngineHandle();
    }

    const strip = ensureTrackStrip(track.id);
    // Scope to the addressed piano. `input.deviceId` located the owning track
    // above and was then discarded here, so on a track hosting two GrandBoules
    // the whole returned handle — noteOn, setParam, setSustain, loadAttackClip
    // — drove the first instance.
    const deviceNode = strip.deviceNodes.find(
        (candidateNode) => candidateNode.deviceId === input.deviceId && candidateNode.grandBouleControls?.ready
    );
    if (deviceNode?.grandBouleControls === undefined) {
        return createDisconnectedGrandBouleEngineHandle();
    }

    const controls = deviceNode.grandBouleControls;
    return {
        noteOn: (noteInput) => controls.noteOn(noteInput.midiNote, noteInput.velocity),
        noteOff: (noteInput) => controls.noteOff(noteInput.midiNote),
        noteOnMidi2: (noteInput) =>
            controls.noteOnMidi2(noteInput.midiNote, noteInput.velocity16bit, noteInput.pitchOffsetQ24),
        setParam: (paramInput) => controls.setParam(paramInput.name, paramInput.value),
        setSustain: (pedalInput) => controls.setSustain(pedalInput.position),
        setUnaCorda: (pedalInput) => controls.setUnaCorda(pedalInput.engaged),
        setSostenuto: (pedalInput) => controls.setSostenuto(pedalInput.engaged),
        setTemperament: (temperamentInput) => controls.setTemperament(temperamentInput.index),
        loadAttackClip: (clipInput) => controls.loadAttackClip(clipInput.key, clipInput.samples),
        allNotesOff: () => controls.allNotesOff(),
        isReady: () => true,
        getAnalyserNode: () => strip.analyserNode,
        sampleRate: () => getAudioSampleRate(),
    };
}
