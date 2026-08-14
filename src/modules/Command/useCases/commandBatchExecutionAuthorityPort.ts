type CommandBatchExecutionAuthorityProvider = () => boolean;

let provider: CommandBatchExecutionAuthorityProvider | null = null;

export const commandBatchExecutionAuthorityPort = {
    setProvider(nextProvider: CommandBatchExecutionAuthorityProvider | null): void {
        provider = nextProvider;
    },
    canExecute(): boolean {
        return provider?.() ?? false;
    },
};
