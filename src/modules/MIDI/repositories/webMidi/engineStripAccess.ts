// Local structural view of an AudioEngine track channel strip — the minimal
// device-node control surface the WebMIDI note-input repositories read to deliver
// live notes to instrument device nodes. Strip access is injected from the MIDI
// use-case layer (AudioEngine owns the concrete `TrackChannelStrip`); duplicating
// the shape here keeps the repository layer free of a cross-module model import.

export type WebMidiInstrumentDeviceNode = {
    deviceId?: string;
    type?: string;
    toasterControls?: { noteOff: (pad: number, sampleFrame?: number) => void };
    fermenterControls?: { noteOff: (note: number, sampleFrame?: number) => void };
    grandBouleControls?: {
        noteOff: (midiNote: number, sampleFrame?: number, releaseVelocity?: number) => void;
    };
    levainControls?: { noteOff: (note: number, sampleFrame?: number) => void };
};

export type WebMidiInstrumentStrip = {
    deviceNodes: WebMidiInstrumentDeviceNode[];
};

export type GetWebMidiTrackStrip = (trackId: string) => WebMidiInstrumentStrip | undefined;

/** Release one voice a native live session is holding; the engine addresses it by strip and device. */
export type NativeLiveNoteRelease = Readonly<{ trackId: string; deviceId: string; note: number; channel: number }>;
export type ReleaseNativeLiveNote = (release: NativeLiveNoteRelease) => void;
