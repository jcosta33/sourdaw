type CommandProjectRevisionProvider = () => string;
type CommandProjectRevisionLiveMatch = (expectedRevision: string) => boolean;

const UNCONFIGURED_PROJECT_REVISION = 'unconfigured-project-revision';

function captureUnconfiguredProjectRevision(): string {
    return UNCONFIGURED_PROJECT_REVISION;
}

let provider: CommandProjectRevisionProvider = captureUnconfiguredProjectRevision;
let providerConfigured = false;
let liveMatch: CommandProjectRevisionLiveMatch | null = null;

export const commandProjectRevisionPort = {
    capture(): string {
        return provider();
    },
    isConfigured(): boolean {
        return providerConfigured;
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
        provider = nextProvider ?? captureUnconfiguredProjectRevision;
        providerConfigured = nextProvider !== null;
        if (nextProvider === null) {
            liveMatch = null;
        }
    },
    setLiveMatchIgnoringSaveWrites(nextMatch: CommandProjectRevisionLiveMatch | null): void {
        liveMatch = nextMatch;
    },
};
