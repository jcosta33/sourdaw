import { invokeWithBinaryBody, isDesktopRuntime } from '#/utils/desktopBridge';

/**
 * Restore a native plugin instance's opaque state chunk from raw bytes.
 *
 * The chunk crosses as the binary invoke payload, so it costs exactly its byte
 * length instead of the ~3.57x JSON decimal number array its `Vec<u8>`-taking
 * predecessor produced (OE-5 / WB-5 / M-109); the instance id travels as
 * positional meta beside it. Stubs out in browser dev mode.
 */
export async function setPluginState(instanceId: string, state: Uint8Array): Promise<void> {
    if (!isDesktopRuntime()) {
        return;
    }
    await invokeWithBinaryBody({
        command: 'set_plugin_state_bytes',
        bytes: state,
        positionalMeta: [instanceId],
    });
}
