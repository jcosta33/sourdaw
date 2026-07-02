const STORAGE_KEY = 'sourdaw:midi:selectedInputId';

export function persistInputId(id: string | null): void {
    try {
        if (id) {
            window.localStorage.setItem(STORAGE_KEY, id);
        } else {
            window.localStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        // storage not available
    }
}
