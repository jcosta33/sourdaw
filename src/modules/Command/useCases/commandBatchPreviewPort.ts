type CommandBatchPreviewWorkspace = {
    getProjectDocument(): Readonly<Record<string, unknown>>;
    release(): void;
    scope<Result>(callback: () => Result): Result;
};

type CommandBatchPreviewWorkspaceProvider = (baseRevision: string) => CommandBatchPreviewWorkspace;

let provider: CommandBatchPreviewWorkspaceProvider | null = null;

export const commandBatchPreviewPort = {
    create(baseRevision: string): CommandBatchPreviewWorkspace | null {
        return provider?.(baseRevision) ?? null;
    },
    setProvider(nextProvider: CommandBatchPreviewWorkspaceProvider | null): void {
        provider = nextProvider;
    },
};
