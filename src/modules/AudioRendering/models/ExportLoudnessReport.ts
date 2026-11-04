export type LoudnessReading =
    | { value: number; unit: 'LUFS' | 'dBTP' }
    | { unavailable: 'empty' | 'short-window' | 'silence' | 'below-gate'; unit: 'LUFS' | 'dBTP' };

export type WavLoudnessReport = {
    algorithmRevision: 'sourdaw-current-kweight-4x12tap-v1';
    measurementBasis: 'decoded-WAV-bytes';
    publicationAttested: false;
    stemId: string;
    targetId: string;
    audioFile: string;
    wav: {
        encoding: 'PCM' | 'IEEE_FLOAT';
        channels: 1 | 2;
        sampleRate: 44100 | 48000 | 88200 | 96000;
        bitDepth: 16 | 24 | 32;
        frames: number;
        bytes: number;
        md5: string;
    };
    integrated: LoudnessReading;
    maxMomentary: LoudnessReading;
    maxShortTerm: LoudnessReading;
    truePeak: LoudnessReading;
};
