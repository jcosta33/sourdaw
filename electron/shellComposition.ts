import { dispatchFocusedNativeMenuIntent } from './applicationMenu.js';
import { createQuitHandler, type PreventableEvent, type QuitDependencies, type ShutdownOutcome } from './shutdown.js';

import type { NativeMenuIntent, NativeTextEditTarget, NativeResponderEditAction } from './applicationMenu.js';
import type { MenuItemConstructorOptions } from 'electron';

export const installMacApplicationMenu = <Menu>({
    isMac,
    build,
    set,
    template,
}: {
    readonly isMac: boolean;
    readonly build: (template: MenuItemConstructorOptions[]) => Menu;
    readonly set: (menu: Menu) => void;
    readonly template: MenuItemConstructorOptions[];
}): void => {
    if (isMac) {
        set(build(template));
    }
};

export const requestApprovedWindowClose = ({
    event,
    requestClose,
    close,
}: {
    readonly event: PreventableEvent;
    readonly requestClose: () => Promise<boolean>;
    readonly close: () => void;
}): void => {
    event.preventDefault();
    void requestClose().then(
        (approved) => {
            if (approved) {
                close();
            }
        },
        () => undefined
    );
};

export const composeQuitHandler = (
    run: () => Promise<ShutdownOutcome>,
    dependencies: Required<Pick<QuitDependencies, 'canQuit' | 'beforeRun'>> &
        Omit<QuitDependencies, 'canQuit' | 'beforeRun'>
): ((event: PreventableEvent) => void) => createQuitHandler(run, dependencies);

export const shouldRecreateRendererAfterCrash = (lifecycle: {
    readonly shouldRecreateAfterCrash: () => boolean;
}): boolean => lifecycle.shouldRecreateAfterCrash();

/** The shell's testable composition root; main supplies Electron concretions only. */
export const createShellComposition = <Menu>({
    isMac,
    buildMenu,
    setMenu,
    getMainTarget,
    isMainTargetFocused,
    sendToNativeResponder,
    dispatchMenuIntent,
    runShutdown,
    quitDependencies,
    lifecycle,
}: {
    readonly isMac: boolean;
    readonly buildMenu: (template: MenuItemConstructorOptions[]) => Menu;
    readonly setMenu: (menu: Menu) => void;
    readonly getMainTarget: () => NativeTextEditTarget | undefined;
    readonly isMainTargetFocused: () => boolean;
    readonly sendToNativeResponder?: (action: NativeResponderEditAction) => void;
    readonly dispatchMenuIntent: (intent: NativeMenuIntent) => void;
    readonly runShutdown: () => Promise<ShutdownOutcome>;
    readonly quitDependencies: Required<Pick<QuitDependencies, 'canQuit' | 'beforeRun'>> &
        Omit<QuitDependencies, 'canQuit' | 'beforeRun'>;
    readonly lifecycle: { readonly shouldRecreateAfterCrash: () => boolean };
}) => ({
    sendMenuIntent: (intent: NativeMenuIntent): void => {
        const target = getMainTarget();
        if (intent.action.startsWith('edit:') && target !== undefined) {
            dispatchFocusedNativeMenuIntent({
                intent,
                isMainWindowFocused: isMainTargetFocused(),
                target,
                send: dispatchMenuIntent,
                sendToNativeResponder,
            });
            return;
        }
        dispatchMenuIntent(intent);
    },
    installMenu: (template: MenuItemConstructorOptions[]): void =>
        installMacApplicationMenu({ isMac, build: buildMenu, set: setMenu, template }),
    beforeQuit: composeQuitHandler(runShutdown, quitDependencies),
    shouldRecreateAfterCrash: (): boolean => shouldRecreateRendererAfterCrash(lifecycle),
});

type ProductionShellWindow = {
    readonly isDestroyed: () => boolean;
    readonly webContents: NativeTextEditTarget;
};

/** Maps the live Electron ownership seams into the policy-only shell composition. */
export const createProductionShellComposition = <Menu>({
    isMac,
    buildMenu,
    setMenu,
    getMainWindow,
    getFocusedWindow,
    sendToFirstResponder,
    menuDispatcher,
    runShutdown,
    closeCoordinator,
    quit,
    lifecycle,
}: {
    readonly isMac: boolean;
    readonly buildMenu: (template: MenuItemConstructorOptions[]) => Menu;
    readonly setMenu: (menu: Menu) => void;
    readonly getMainWindow: () => ProductionShellWindow | undefined;
    readonly getFocusedWindow: () => unknown;
    readonly sendToFirstResponder: (action: NativeResponderEditAction) => void;
    readonly menuDispatcher: { readonly dispatch: (intent: NativeMenuIntent) => void };
    readonly runShutdown: () => Promise<ShutdownOutcome>;
    readonly closeCoordinator: { readonly requestClose: () => Promise<boolean> };
    readonly quit: Required<Pick<QuitDependencies, 'exit' | 'report'>> & {
        readonly quiesceBeforeQuit: NonNullable<QuitDependencies['beforeRun']>;
        readonly timers?: QuitDependencies['timers'];
    };
    readonly lifecycle: {
        readonly approveTeardown: () => void;
        readonly shouldRecreateAfterCrash: () => boolean;
    };
}) =>
    createShellComposition({
        isMac,
        buildMenu,
        setMenu,
        getMainTarget: () => {
            const window = getMainWindow();
            return window === undefined || window.isDestroyed() ? undefined : window.webContents;
        },
        isMainTargetFocused: () => {
            const window = getMainWindow();
            return window !== undefined && !window.isDestroyed() && getFocusedWindow() === window;
        },
        sendToNativeResponder: isMac ? sendToFirstResponder : undefined,
        dispatchMenuIntent: (intent) => menuDispatcher.dispatch(intent),
        runShutdown,
        quitDependencies: {
            canQuit: async () => {
                const approved = await closeCoordinator.requestClose();
                if (approved) {
                    lifecycle.approveTeardown();
                }
                return approved;
            },
            beforeRun: quit.quiesceBeforeQuit,
            exit: quit.exit,
            report: quit.report,
            ...(quit.timers === undefined ? {} : { timers: quit.timers }),
        },
        lifecycle,
    });
