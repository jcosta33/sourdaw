export type FaustModule = {
    id: string;
    name: string;
    dspCode: string;
    paramDescriptors: FaustParamDescriptor[];
    compiled: boolean;
    isInstrument: boolean;
    generator: import('@grame/faustwasm').FaustMonoDspGenerator | import('@grame/faustwasm').FaustPolyDspGenerator | null;
};

export type FaustParamDescriptor = {
    address: string;
    label: string;
    min: number;
    max: number;
    defaultValue: number;
    step: number;
    type: 'hslider' | 'vslider' | 'nentry' | 'button' | 'checkbox' | 'hbargraph' | 'vbargraph';
    scaling?: 'log' | 'linear';
};
