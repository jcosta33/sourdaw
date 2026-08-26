type CommandRuntimeRepairProvider = () => void | Promise<void>;

let provider: CommandRuntimeRepairProvider | null = null;

export const commandRuntimeRepairPort = {
    repair(): Promise<void> | null {
        if (!provider) {
            return null;
        }
        return Promise.resolve(provider());
    },
    setProvider(nextProvider: CommandRuntimeRepairProvider | null): void {
        provider = nextProvider;
    },
};
