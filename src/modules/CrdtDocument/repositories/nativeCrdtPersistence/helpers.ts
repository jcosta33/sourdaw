export function isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI__' in window;
}
