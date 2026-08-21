/**
 * Thin I/O contract for the retained Grand Boule engine host.
 *
 * The runtime graph wiring (AudioWorklet construction, SharedArrayBuffer
 * plumbing, device-registry integration) lives in the AudioEngine module in
 * a follow-up task. This file exposes the narrow contract the rest of the
 * Grand Boule module talks to so that engine integration can swap in behind
 * it without touching use cases.
 */

export type GrandBouleEngineHandle = {
    /** Trigger a note. MIDI notes outside A0..C8 are ignored silently. */
    noteOn: (input: { midiNote: number; velocity: number }) => void;
    /**
     * Trigger a note with MIDI 2.0 fidelity: 16-bit velocity and a signed
     * microtuning pitch offset in semitones × 2^24 (Q24).
     */
    noteOnMidi2: (input: { midiNote: number; velocity16bit: number; pitchOffsetQ24: number }) => void;
    /** Release any voice(s) currently playing `midiNote`. */
    noteOff: (input: { midiNote: number }) => void;
    /** Set a global parameter by name (`master_gain`, `soundboard_send`, …). */
    setParam: (input: { name: string; value: number }) => void;
    /** Continuous sustain pedal (CC64). 0 = released, 1 = fully engaged. */
    setSustain: (input: { position: number }) => void;
    /** Una corda (CC67) pedal state. */
    setUnaCorda: (input: { engaged: boolean }) => void;
    /** Sostenuto (CC66) pedal state. */
    setSostenuto: (input: { engaged: boolean }) => void;
    /** Set historical temperament (0=Equal, 1=Werckmeister III, 2=Kirnberger III, 3=Vallotti, 4=Young II, 5=Meantone ¼-comma). */
    setTemperament: (input: { index: number }) => void;
    /** Load an attack-transient clip for the hybrid pathway (§3.3). */
    loadAttackClip: (input: { key: number; samples: Float32Array }) => void;
    /** Panic: silence every voice immediately. */
    allNotesOff: () => void;
    /** Whether this handle is connected to a live engine instance. */
    isReady: () => boolean;
    /** The track's AnalyserNode for visualization (FFT, metering). */
    getAnalyserNode: () => AnalyserNode | null;
    /**
     * The engine AudioContext sample rate (Hz). Attack clips authored at a
     * different rate must be resampled to this before being forwarded so they
     * play back at the correct pitch (§3.3). Defaults to 44.1 kHz on the
     * disconnected handle, which never forwards anything.
     */
    sampleRate: () => number;
};

/**
 * A no-op handle used while release admission withholds engine construction.
 * Keeps use-case call sites branchless and supports focused tests without a
 * distributed constructor.
 */
export function createDisconnectedGrandBouleEngineHandle(): GrandBouleEngineHandle {
    return {
        noteOn: () => {},
        noteOnMidi2: () => {},
        noteOff: () => {},
        setParam: () => {},
        setSustain: () => {},
        setUnaCorda: () => {},
        setSostenuto: () => {},
        setTemperament: () => {},
        loadAttackClip: () => {},
        allNotesOff: () => {},
        isReady: () => false,
        getAnalyserNode: () => null,
        sampleRate: () => 44100,
    };
}
