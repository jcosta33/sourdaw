import { writeSidebarFavoritesText } from '../../repositories/sidebar-favorites/write-sidebar-favorites-text';

export function saveSidebarFavorites(favorites: Set<string>): void {
    writeSidebarFavoritesText(JSON.stringify([...favorites]));
}
