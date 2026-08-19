import { invokeForBinaryResponse, isDesktopRuntime } from '#/utils/desktopBridge';

/**
 * Read a native plugin instance's opaque state chunk as raw bytes.
 *
 * `get_plugin_state_bytes` answers over the binary IPC path, so the chunk
 * arrives as raw bytes instead of the JSON decimal number array its
 * `Vec<u8>`-returning predecessor produced (OE-5 / WB-5 / M-109). Only the
 * response is binary — the request carries nothing but the instance id, so it
 * stays an ordinary JSON argument.
 *
 * Returns an empty chunk in browser dev mode, which callers read as "no state"
 * rather than "clear the stored state".
 */
export async function getPluginState(instanceId: string): Promise<Uint8Array> {
    if (!isDesktopRuntime()) {
        return new Uint8Array();
    }
    return invokeForBinaryResponse({ command: 'get_plugin_state_bytes', args: { instanceId } });
}
