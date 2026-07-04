const USER_PATCHES_STORAGE_KEY = 'fermenter-user-patches';

export function writeUserPatchesText(value: string): boolean {
    if (typeof window === 'undefined') {
        return false;
    }

    try {
        // eslint-disable-next-line no-restricted-syntax -- Preserve the legacy plain JSON Fermenter user-patches array stored under this key.
        window.localStorage.setItem(USER_PATCHES_STORAGE_KEY, value);
        return true;
    } catch {
        return false;
    }
}
