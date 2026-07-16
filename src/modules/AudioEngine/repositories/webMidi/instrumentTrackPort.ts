export type WebMidiInstrumentTrack = Readonly<{
    id: string;
    devices: readonly Readonly<{
        id: string;
        type: string;
    }>[];
}>;
