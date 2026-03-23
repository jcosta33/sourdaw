export type DrumVoiceType =
    | 'kick'
    | 'snare'
    | 'clap'
    | 'closed-hh'
    | 'open-hh'
    | 'tom-low'
    | 'tom-mid'
    | 'tom-high'
    | 'cowbell'
    | 'rimshot'
    | 'conga-low'
    | 'conga-mid'
    | 'conga-high'
    | 'maracas'
    | 'clave';

export type DrumVoiceDef = {
    name: string;
    midiNote: number;
    type: DrumVoiceType;
};

export type DrumKitDef = {
    id: string;
    name: string;
    voices: DrumVoiceDef[];
};
