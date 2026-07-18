const STORAGE_KEY = 'sourdaw:midi:selectedInputId';

export function readPersistedInputId(): string | null {
    try {
        return window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}
