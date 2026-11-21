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

let registeredProvider: CommandBatchPreflightProvider | null = null;

/**
 * Command may not import the module that reads the project document, so the
 * composition root (`#/app/bootstrap`) fills this once at boot.
 */
export const commandBatchPreflightPort = {
    /**
     * Reading before registration throws rather than answering `null`: a
     * batch checked against no state would be rejected as "unavailable" and
     * hide the wiring fault.
     */
    capture(input: CommandBatchPreflightCaptureInput): CommandBatchPreflightState {
        if (registeredProvider === null) {
            throw new Error(
                'commandBatchPreflightPort.capture: the preflight provider is not registered; call commandBatchPreflightPort.setProvider() from #/app/bootstrap'
            );
        }
        return registeredProvider(input);
    },
    setProvider(nextProvider: CommandBatchPreflightProvider): void {
        registeredProvider = nextProvider;
    },
};
