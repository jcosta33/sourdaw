type CommandBatchExecutionAuthorityProvider = () => boolean;

let registeredProvider: CommandBatchExecutionAuthorityProvider | null = null;

/**
 * Filled from inside Command by `configureCommandBatchIdempotency`, which the
 * composition root (`#/app/bootstrap`) calls once at boot.
 */
export const commandBatchExecutionAuthorityPort = {
    setProvider(nextProvider: CommandBatchExecutionAuthorityProvider): void {
        registeredProvider = nextProvider;
    },
    /**
     * Reading before registration throws rather than denying: a denial would
     * read as "another host is authoritative" and hide the wiring fault.
     */
    canExecute(): boolean {
        if (registeredProvider === null) {
            throw new Error(
                'commandBatchExecutionAuthorityPort.canExecute: the execution authority is not registered; call commandBatchExecutionAuthorityPort.setProvider() from #/app/bootstrap'
            );
        }
        return registeredProvider();
    },
};
