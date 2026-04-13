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
    /** Unique instance ID — returned by loadWAMPlugin, passed to unloadWAMPlugin. */
    instanceId: string;
    descriptor: WAMDescriptor;
    audioNode: AudioNode;
    initialized: boolean;
    groupId: string;
};
