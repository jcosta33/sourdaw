const USER_PATCHES_STORAGE_KEY = 'fermenter-user-patches';

export function readUserPatchesText(): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        // eslint-disable-next-line no-restricted-syntax -- Fermenter user patches use a legacy plain JSON array; createLocalStorage would rewrite this key as SuperJSON.
        return window.localStorage.getItem(USER_PATCHES_STORAGE_KEY);
    } catch {
        return null;
    }
}
