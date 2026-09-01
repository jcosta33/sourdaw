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
    matchesLiveIgnoringCommandCheckpoint(expectedRevision: string): boolean {
        if (provider() === expectedRevision) {
            return true;
        }
        return liveMatch?.(expectedRevision) === true;
    },
    setProvider(nextProvider: CommandProjectRevisionProvider | null): void {
        provider = nextProvider ?? captureUnconfiguredProjectRevision;
        providerConfigured = nextProvider !== null;
        if (nextProvider === null) {
            liveMatch = null;
        }
    },
    setLiveMatchIgnoringCommandCheckpoint(nextMatch: CommandProjectRevisionLiveMatch | null): void {
        liveMatch = nextMatch;
    },
};
