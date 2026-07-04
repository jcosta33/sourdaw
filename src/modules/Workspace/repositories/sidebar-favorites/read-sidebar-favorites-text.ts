const SIDEBAR_FAVORITES_STORAGE_KEY = 'sourdaw-favorites';

export function readSidebarFavoritesText(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        // eslint-disable-next-line no-restricted-syntax -- Sidebar favorites use a legacy plain JSON array; createLocalStorage would rewrite this key as SuperJSON.
        return window.localStorage.getItem(SIDEBAR_FAVORITES_STORAGE_KEY);
    } catch {
        return null;
    }
}
