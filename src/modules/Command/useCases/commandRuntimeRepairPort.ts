type CommandRuntimeRepairProvider = () => void | Promise<void>;

let registeredProvider: CommandRuntimeRepairProvider | null = null;

/**
 * Command may not import the module that owns the runtime graph, so the
 * composition root (`#/app/bootstrap`) fills this once at boot.
 */
export const commandRuntimeRepairPort = {
    /**
     * Reading before registration throws rather than reporting that no repair
     * exists: a recovery that skipped its repair would leave a pending runtime
     * graph effect looking resolved.
     */
    repair(): Promise<void> {
        if (registeredProvider === null) {
            throw new Error(
                'commandRuntimeRepairPort.repair: the runtime repair provider is not registered; call commandRuntimeRepairPort.setProvider() from #/app/bootstrap'
            );
        }
        return Promise.resolve(registeredProvider());
    },
    setProvider(nextProvider: CommandRuntimeRepairProvider): void {
        registeredProvider = nextProvider;
    },
};
