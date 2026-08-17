import { invokeWithBinaryBody, isTauri } from '#/utils/tauriBridge';

/**
 * Header carrying the percent-encoded plugin instance id for
 * `set_plugin_state_bytes`.
 *
 * The raw-body IPC path makes the state chunk the *whole* invoke message, so the
 * instance id cannot ride along as a sibling field — the same constraint that
 * put the destination path in a header for `write_file_bytes`. Header values
 * must be printable ASCII; Rust's shared `binary_ipc` decoder validates and
 * decodes it back to UTF-8.
 */
export const PLUGIN_INSTANCE_HEADER = 'x-sourdaw-plugin-instance';

/**
 * Restore a native plugin instance's opaque state chunk from raw bytes.
 *
 * The chunk crosses as the entire invoke message, so it costs exactly its byte
 * length instead of the ~3.57x JSON decimal number array its `Vec<u8>`-taking
 * predecessor produced (OE-5 / WB-5 / M-109). Stubs out in browser dev mode.
 */
export async function setPluginState(instanceId: string, state: Uint8Array): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await invokeWithBinaryBody({
        command: 'set_plugin_state_bytes',
        bytes: state,
        headers: { [PLUGIN_INSTANCE_HEADER]: encodeURIComponent(instanceId) },
        positionalMeta: [instanceId],
    });
}
