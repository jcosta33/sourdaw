import { createQuitHandler, type PreventableEvent, type QuitDependencies, type ShutdownOutcome } from './shutdown.js';

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
    void requestClose().then((approved) => {
        if (approved) {
            close();
        }
    });
};

export const composeQuitHandler = (
    run: () => Promise<ShutdownOutcome>,
    dependencies: Required<Pick<QuitDependencies, 'canQuit' | 'beforeRun'>> &
        Omit<QuitDependencies, 'canQuit' | 'beforeRun'>
): ((event: PreventableEvent) => void) => createQuitHandler(run, dependencies);

export const shouldRecreateRendererAfterCrash = (lifecycle: {
    readonly shouldRecreateAfterCrash: () => boolean;
}): boolean => lifecycle.shouldRecreateAfterCrash();
