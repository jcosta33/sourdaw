export type WAMDescriptor = {
    id: string;
    name: string;
    vendor: string;
    version: string;
    category: 'effect' | 'instrument' | 'midi-effect';
    sdkVersion: string;
    thumbnail?: string;
    keywords?: string[];
    isHighEnd?: boolean;
};

export type WAMInstance = {
    descriptor: WAMDescriptor;
    audioNode: AudioNode;
    initialized: boolean;
    groupId: string;
};
