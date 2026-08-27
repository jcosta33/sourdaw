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
    projectDocument?: Readonly<Record<string, unknown>>;
    targetIds: readonly string[];
};

type CommandBatchPreflightState = {
    /**
     * Fingerprints taken from the live projection rather than the project
     * document. Condition evaluation never reads them: a staged document and a
     * live projection are different authorities, and comparing across the two
     * attributes another writer's change to this batch. Absent from a provider
     * that derives everything from the document.
     */
    advertisedTargetFingerprints?: Readonly<Record<string, string>>;
    audioGraphValid: boolean;
    availableAssetHashes: readonly string[];
    availableAudioBufferIds: readonly string[];
    lockedRanges: readonly CommandBatchPreflightRange[];
    projectId: string;
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
