/**
 * The text every cancelled native render's error carries
 * (`OFFLINE_RENDER_CANCELLED` in `crates/sourdaw-native/src/commands/
 * offline_plugins.rs`). A seam contract — never reword one side alone.
 */
export const NATIVE_OFFLINE_RENDER_CANCELLED = 'offline-render-cancelled';

/**
 * Whether a failed render was one `cancel_graph_offline` stopped. Matched as
 * contained rather than leading text: the desktop IPC prefixes the native
 * message with its own channel name when it rejects the invoke.
 */
export function isNativeOfflineRenderCancelled(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(NATIVE_OFFLINE_RENDER_CANCELLED);
}
