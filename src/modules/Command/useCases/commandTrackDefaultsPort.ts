type TrackColorProvider = () => string;

let trackColorProvider: TrackColorProvider | null = null;

export const commandTrackDefaultsPort = {
    reserveTrackColor(): string | undefined {
        return trackColorProvider?.();
    },
    setTrackColorProvider(provider: TrackColorProvider | null): void {
        trackColorProvider = provider;
    },
};
