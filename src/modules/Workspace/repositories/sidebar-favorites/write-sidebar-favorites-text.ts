const SIDEBAR_FAVORITES_STORAGE_KEY = 'sourdaw-favorites';

export function writeSidebarFavoritesText(value: string): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        // eslint-disable-next-line no-restricted-syntax -- Preserve the legacy plain JSON sidebar favorites array stored under this key.
        window.localStorage.setItem(SIDEBAR_FAVORITES_STORAGE_KEY, value);
    } catch {
        /* storage unavailable */
    }
}
