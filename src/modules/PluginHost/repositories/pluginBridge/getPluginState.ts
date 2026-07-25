import { invokeForBinaryResponse, isTauri } from '#/utils/tauriBridge';

/**
 * Read a native plugin instance's opaque state chunk as raw bytes.
 *
 * `get_plugin_state_bytes` answers with a `tauri::ipc::Response`, so the chunk
 * arrives as an `ArrayBuffer` instead of the JSON decimal number array its
 * `Vec<u8>`-returning predecessor produced (OE-5 / WB-5 / M-109). Only the
 * response is binary — the request carries nothing but the instance id, so it
 * stays an ordinary JSON argument.
 *
 * Returns an empty chunk in browser dev mode, which callers read as "no state"
 * rather than "clear the stored state".
 */
export async function getPluginState(instanceId: string): Promise<Uint8Array> {
    if (!isTauri()) {
        return new Uint8Array();
    }
    return invokeForBinaryResponse({ command: 'get_plugin_state_bytes', args: { instanceId } });
}
