export type WebMidiInstrumentTrack = {
    id: string;
    devices: readonly {
        id: string;
        type: string;
    }[];
};
