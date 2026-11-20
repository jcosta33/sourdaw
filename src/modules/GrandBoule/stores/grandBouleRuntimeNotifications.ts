const listeners = new Map<string, Set<() => void>>();

export function subscribeToGrandBouleRuntime(deviceId: string, listener: () => void): () => void {
    const deviceListeners = listeners.get(deviceId) ?? new Set<() => void>();
    listeners.set(deviceId, deviceListeners);
    deviceListeners.add(listener);
    return () => {
        if (deviceListeners.delete(listener) && deviceListeners.size === 0) {
            listeners.delete(deviceId);
        }
    };
}

export function notifyGrandBouleRuntimeReady(deviceId: string): void {
    const deviceListeners = listeners.get(deviceId);
    if (!deviceListeners) {
        return;
    }
    for (const listener of [...deviceListeners]) {
        listener();
    }
}
