type CommandProjectRevisionProvider = () => string;

const UNCONFIGURED_PROJECT_REVISION = 'unconfigured-project-revision';

function captureUnconfiguredProjectRevision(): string {
    return UNCONFIGURED_PROJECT_REVISION;
}

let provider: CommandProjectRevisionProvider = captureUnconfiguredProjectRevision;

export const commandProjectRevisionPort = {
    capture(): string {
        return provider();
    },
    setProvider(nextProvider: CommandProjectRevisionProvider | null): void {
        provider = nextProvider ?? captureUnconfiguredProjectRevision;
    },
};
