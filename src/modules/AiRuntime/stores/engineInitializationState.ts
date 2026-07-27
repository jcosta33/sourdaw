let activeController: AbortController | null = null;

export const engineInitializationState = {
    begin(): AbortController {
        activeController?.abort();
        const controller = new AbortController();
        activeController = controller;
        return controller;
    },

    cancel(): void {
        activeController?.abort();
        activeController = null;
    },

    finish(controller: AbortController): void {
        if (activeController === controller) {
            activeController = null;
        }
    },
};
