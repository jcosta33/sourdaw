export type MixerChannelSnapshot = {
    trackId: string;
    gain: number;
    pan: number;
    muted: boolean;
    soloed: boolean;
};

export type MixerSnapshot = {
    id: string;
    name: string;
    createdAt: number;
    channels: MixerChannelSnapshot[];
};
