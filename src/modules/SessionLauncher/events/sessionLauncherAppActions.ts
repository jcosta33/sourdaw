export type SessionLauncherAppAction =
    { type: 'toggleLoopRecord'; payload: { slotId: string } } | { type: 'triggerScene'; payload: { column: number } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        sessionLauncher: SessionLauncherAppAction;
    }
}
