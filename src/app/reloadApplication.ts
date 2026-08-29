type ReloadableLocation = {
    reload: () => void;
};

export function reloadApplication(location: ReloadableLocation): void {
    location.reload();
}
