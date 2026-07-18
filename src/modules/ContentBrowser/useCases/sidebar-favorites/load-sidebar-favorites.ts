import { readSidebarFavoritesText } from '../../repositories/sidebar-favorites/read-sidebar-favorites-text';

type SanitizeStoredFavoritesOutput = Set<string>;

function sanitizeStoredFavorites(value: unknown): SanitizeStoredFavoritesOutput {
    if (!Array.isArray(value)) {
        return new Set<string>();
    }

    const favorites = new Set<string>();
    for (const favorite of value) {
        if (typeof favorite === 'string') {
            favorites.add(favorite);
        }
    }

    return favorites;
}

type LoadSidebarFavoritesOutput = Set<string>;

export function loadSidebarFavorites(): LoadSidebarFavoritesOutput {
    const stored = readSidebarFavoritesText();
    if (stored === null) {
        return new Set<string>();
    }

    try {
        const parsed: unknown = JSON.parse(stored);
        return sanitizeStoredFavorites(parsed);
    } catch {
        return new Set<string>();
    }
}
