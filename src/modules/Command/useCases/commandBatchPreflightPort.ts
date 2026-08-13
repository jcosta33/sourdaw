type CommandBatchPreflightRange = {
    startBeat: number;
    endBeat: number;
};

type CommandBatchAssetReference = {
    assetHash?: string;
    audioBufferId?: string;
};

type CommandBatchPreflightCaptureInput = {
    assetReferences: readonly CommandBatchAssetReference[];
    targetIds: readonly string[];
};

type CommandBatchPreflightState = {
    audioGraphValid: boolean;
    availableAssetHashes: readonly string[];
    availableAudioBufferIds: readonly string[];
    lockedRanges: readonly CommandBatchPreflightRange[];
    projectInvariantsValid: boolean;
    targetFingerprints: Readonly<Record<string, string>>;
};

type CommandBatchPreflightProvider = (input: CommandBatchPreflightCaptureInput) => CommandBatchPreflightState;

let provider: CommandBatchPreflightProvider | null = null;

export const commandBatchPreflightPort = {
    capture(input: CommandBatchPreflightCaptureInput): CommandBatchPreflightState | null {
        return provider?.(input) ?? null;
    },
    setProvider(nextProvider: CommandBatchPreflightProvider | null): void {
        provider = nextProvider;
    },
};
