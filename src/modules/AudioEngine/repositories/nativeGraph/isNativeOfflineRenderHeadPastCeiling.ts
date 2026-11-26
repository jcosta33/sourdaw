/**
 * The text a trimmed native render's error carries when its requested frames
 * fit the frame ceiling but the engine's own compensation head rendered ahead
 * of them does not (`OFFLINE_RENDER_HEAD_PAST_CEILING` in
 * `crates/sourdaw-native/src/commands/graph.rs`). A seam contract — never
 * reword one side alone.
 */
export const NATIVE_OFFLINE_RENDER_HEAD_PAST_CEILING = 'offline-render-head-past-ceiling';

/**
 * Whether a failed render was refused for its compensation head alone. Matched
 * as contained rather than leading text: the desktop IPC prefixes the native
 * message with its own channel name when it rejects the invoke.
 */
export function isNativeOfflineRenderHeadPastCeiling(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(NATIVE_OFFLINE_RENDER_HEAD_PAST_CEILING);
}
