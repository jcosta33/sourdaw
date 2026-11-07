type CommandProjectRevisionProvider = () => string;
type CommandProjectRevisionLiveMatch = (expectedRevision: string) => boolean;
type CommandProjectMutationAuthority = {
    revisionProvider: CommandProjectRevisionProvider;
    captureMutationAuthorization: () => () => boolean;
};

const UNCONFIGURED_PROJECT_REVISION = 'unconfigured-project-revision';

function captureUnconfiguredProjectRevision(): string {
    return UNCONFIGURED_PROJECT_REVISION;
}

let provider: CommandProjectRevisionProvider = captureUnconfiguredProjectRevision;
let providerConfigured = false;
let liveMatch: CommandProjectRevisionLiveMatch | null = null;
let mutationAuthority: CommandProjectMutationAuthority | null = null;
let configurationGeneration = 0;

export const commandProjectRevisionPort = {
    capture(): string {
        return provider();
    },
    isConfigured(): boolean {
        return providerConfigured;
    },
    configureMutationAuthority(authority: CommandProjectMutationAuthority): void {
        if (mutationAuthority === null) {
            mutationAuthority = { ...authority };
            return;
        }
        if (
            mutationAuthority.revisionProvider !== authority.revisionProvider ||
            mutationAuthority.captureMutationAuthorization !== authority.captureMutationAuthorization
        ) {
            throw new Error(
                'commandProjectRevisionPort.configureMutationAuthority: the authority differs from the registered one'
            );
        }
    },
    /** Capture outside a change and invoke in the executing transaction before its first publication. */
    captureMutationAuthorization(): () => boolean {
        if (!providerConfigured) {
            throw new Error('Command batch postcondition authority requires a configured project revision provider');
        }
        const capturedProvider = provider;
        const capturedGeneration = configurationGeneration;
        const capturedRevision = provider();
        const ownsMutations =
            mutationAuthority?.revisionProvider === capturedProvider
                ? mutationAuthority.captureMutationAuthorization()
                : null;
        return () =>
            configurationGeneration === capturedGeneration &&
            provider === capturedProvider &&
            (ownsMutations ? ownsMutations() : provider() === capturedRevision);
    },
    /**
     * A registered matcher answers alone, even for the exact live revision: the provider reads heads
     * as they stand, while the matcher may first settle store writes the heads do not hold yet.
     */
    matchesLiveIgnoringSaveWrites(expectedRevision: string): boolean {
        if (liveMatch) {
            return liveMatch(expectedRevision);
        }
        return provider() === expectedRevision;
    },
    setProvider(nextProvider: CommandProjectRevisionProvider | null): void {
        configurationGeneration += 1;
        provider = nextProvider ?? captureUnconfiguredProjectRevision;
        providerConfigured = nextProvider !== null;
        if (nextProvider === null) {
            liveMatch = null;
        }
    },
    setLiveMatchIgnoringSaveWrites(nextMatch: CommandProjectRevisionLiveMatch | null): void {
        configurationGeneration += 1;
        liveMatch = nextMatch;
    },
};
