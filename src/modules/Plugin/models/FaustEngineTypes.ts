export type FaustModule = {
    id: string;
    name: string;
    dspCode: string;
    paramDescriptors: FaustParamDescriptor[];
    compiled: boolean;
    generator: import('@grame/faustwasm').FaustMonoDspGenerator | null;
};

export type FaustParamDescriptor = {
    address: string;
    label: string;
    min: number;
    max: number;
    defaultValue: number;
    step: number;
    type: 'hslider' | 'vslider' | 'nentry' | 'button' | 'checkbox' | 'vbargraph' | 'hbargraph';
};
