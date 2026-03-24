export type SampleRegion = {
    keyLo: number;
    keyHi: number;
    velLo: number;
    velHi: number;
    sampleUrl: string;
    rootKey: number;
    loopStart?: number;
    loopEnd?: number;
    tuning: number; // cents
    volume: number; // dB
    pan: number; // -100 to 100
};

export type SFZInstrument = {
    id: string;
    name: string;
    format: 'sfz' | 'sf2';
    regions: SampleRegion[];
    globalDefaults: Partial<SampleRegion>;
    loaded: boolean;
    sampleBuffers: Map<string, AudioBuffer>;
};
