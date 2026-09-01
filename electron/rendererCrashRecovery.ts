/**
 * Renderer crash recovery is shell lifecycle policy, kept independent from
 * Electron so its replacement/teardown ordering remains executable in specs.
 */
export type RendererCrashRecoveryInput<Window> = {
    readonly shouldRecreate: () => boolean;
    readonly createReplacement: () => Window;
    readonly clearPending: (window: Window) => void;
    readonly recoverPending: (crashed: Window, replacement: Window) => void;
    readonly clearCurrent: () => void;
    readonly clearForNoWindow: () => void;
    readonly now: () => number;
    readonly maxRecreates: number;
    readonly recreateWindowMs: number;
};

export const createRendererCrashRecovery = <Window>({
    shouldRecreate,
    createReplacement,
    clearPending,
    recoverPending,
    clearCurrent,
    clearForNoWindow,
    now,
    maxRecreates,
    recreateWindowMs,
}: RendererCrashRecoveryInput<Window>) => {
    let recreateTimestamps: number[] = [];

    return {
        recover(crashed: Window, destroyCrashed: () => void, onExhausted: () => void): void {
            if (!shouldRecreate()) {
                clearPending(crashed);
                destroyCrashed();
                clearCurrent();
                return;
            }

            const current = now();
            recreateTimestamps = recreateTimestamps.filter((at) => current - at < recreateWindowMs);
            if (recreateTimestamps.length >= maxRecreates) {
                clearPending(crashed);
                destroyCrashed();
                clearForNoWindow();
                onExhausted();
                return;
            }

            recreateTimestamps.push(current);
            const replacement = createReplacement();
            recoverPending(crashed, replacement);
            destroyCrashed();
        },
    };
};
