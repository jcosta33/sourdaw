/**
 * Source-owned shape of the retained Grand Boule host instance.
 *
 * The distributed `daw-dsp` package deliberately provides no constructor or
 * generated type for this interface. Preserved host tests replace
 * `createGrandBouleWasmInstance` at the module boundary with an in-memory test
 * implementation; production remains inert while release admission withholds
 * Grand Boule.
 */
export type GrandBouleInstance = {
    free: () => void;
    all_notes_off: () => void;
    get_nan_flush_count: () => number;
    get_right_ptr: () => number;
    lifecycle_state: () => number;
    load_attack_clip: (key: number, samples: Float32Array) => void;
    note_expression: (
        midiNote: number,
        channel: number,
        bendSemitones: number,
        pressure: number,
        slide: number
    ) => void;
    note_off: (midiNote: number) => void;
    note_off_on_channel: (midiNote: number, channel: number) => void;
    note_on: (midiNote: number, velocity: number) => void;
    note_on_midi2: (midiNote: number, velocity16bit: number, pitchOffsetQ24: number) => void;
    note_on_with_channel: (midiNote: number, velocity: number, channel: number) => void;
    process: (blockSize: number) => number;
    set_param: (name: string, value: number) => void;
    set_sostenuto: (engaged: boolean) => void;
    set_sustain: (position: number) => void;
    set_temperament: (index: number) => void;
    set_una_corda: (engaged: boolean) => void;
};

/**
 * Production construction is intentionally unavailable. Tests inject their
 * structural instance by mocking this function, never the generated WASM API.
 */
export function createGrandBouleWasmInstance(_sampleRate: number, _voiceCount: number): GrandBouleInstance {
    throw new Error('Grand Boule has no constructor in distributed daw-dsp WASM');
}
