export type AudioRoute = {
    id: string;
    sourceId: string;
    destinationId: string;
    gain: number;
};

export type AudioGraphState = {
    routes: AudioRoute[];
};

export const defaultAudioGraphState: AudioGraphState = {
    routes: [],
};
