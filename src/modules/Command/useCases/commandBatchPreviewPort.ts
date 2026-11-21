type CommandBatchPreviewWorkspace = {
    getProjectDocument(): Readonly<Record<string, unknown>>;
    release(): void;
    scope<Result>(callback: () => Result): Result;
};

type CommandBatchPreviewWorkspaceProvider = (baseRevision: string) => CommandBatchPreviewWorkspace;

let registeredProvider: CommandBatchPreviewWorkspaceProvider | null = null;
let registeredRecoveryProvider: CommandBatchPreviewWorkspaceProvider | null = null;

/**
 * Command may not import the module that owns the project document, so the
 * composition root (`#/app/bootstrap`) fills both providers once at boot.
 * A later fill replaces the earlier one. A
 * provider that cannot build a workspace throws; it never answers `null`.
 */
export const commandBatchPreviewPort = {
    create(baseRevision: string): CommandBatchPreviewWorkspace {
        if (registeredProvider === null) {
            throw new Error(
                'commandBatchPreviewPort.create: the preview workspace provider is not registered; call commandBatchPreviewPort.setProvider() from #/app/bootstrap'
            );
        }
        return registeredProvider(baseRevision);
    },
    createRecovery(baseRevision: string): CommandBatchPreviewWorkspace {
        if (registeredRecoveryProvider === null) {
            throw new Error(
                'commandBatchPreviewPort.createRecovery: the recovery workspace provider is not registered; call commandBatchPreviewPort.setRecoveryProvider() from #/app/bootstrap'
            );
        }
        return registeredRecoveryProvider(baseRevision);
    },
    setProvider(nextProvider: CommandBatchPreviewWorkspaceProvider): void {
        registeredProvider = nextProvider;
    },
    setRecoveryProvider(nextProvider: CommandBatchPreviewWorkspaceProvider): void {
        registeredRecoveryProvider = nextProvider;
    },
};
