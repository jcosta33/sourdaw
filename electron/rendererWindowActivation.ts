/** Start a fresh macOS renderer generation without replaying stale windowless menu work. */
export const activateRendererWindow = <Window>({
    hasLiveWindow,
    clearPending,
    createWindow,
}: {
    readonly hasLiveWindow: () => boolean;
    readonly clearPending: () => void;
    readonly createWindow: () => Window;
}): Window | undefined => {
    if (hasLiveWindow()) {
        return undefined;
    }
    clearPending();
    return createWindow();
};
