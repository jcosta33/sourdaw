export type NearbySession = {
    instanceName: string;
    hostName: string;
    sessionId: string;
    projectName: string;
    approvalRequired: boolean;
    addresses: string[];
    port: number;
};

const isTauriAvailable = (): boolean => {
    return typeof window !== 'undefined' && '__TAURI__' in window;
};

const invokeCommand = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (!isTauriAvailable()) {
        return null;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
};

/** Start advertising a session on the local network (Tauri only). */
export const startAdvertising = async (
    sessionId: string,
    hostName: string,
    projectName: string,
    port: number,
    approvalRequired: boolean,
): Promise<boolean> => {
    const result = await invokeCommand('collab_start_advertising', {
        sessionId,
        hostName,
        projectName,
        port,
        approvalRequired,
    });
    return Boolean(result);
};

/** Stop advertising the current session. */
export const stopAdvertising = async (): Promise<void> => {
    await invokeCommand('collab_stop_advertising');
};

/** Start browsing for nearby sessions. */
export const startBrowsing = async (): Promise<boolean> => {
    const result = await invokeCommand('collab_start_browsing');
    return Boolean(result);
};

/** Get the list of currently discovered nearby sessions. */
export const getNearbySessions = async (): Promise<NearbySession[]> => {
    const result = await invokeCommand('collab_get_nearby_sessions');
    if (!result || !Array.isArray(result)) {
        return [];
    }
    return result as NearbySession[];
};

/** Check if LAN discovery is available (requires Tauri). */
export const isLanDiscoveryAvailable = (): boolean => {
    return isTauriAvailable();
};
