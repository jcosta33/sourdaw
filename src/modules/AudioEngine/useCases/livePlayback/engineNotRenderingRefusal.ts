/**
 * Whether a batch refusal reason says the engine itself has stopped rendering.
 *
 * `apply_graph_commands` in `crates/sourdaw-native/src/commands/graph.rs` is
 * the one producer of this prefix: it refuses every batch, with a reason
 * starting `engine-not-rendering:`, for as long as the output stream is not
 * calling back. Every caller that needs to tell that condition apart from an
 * ordinary capacity refusal shares this one check, so the prefix is spelled
 * once — and `describeEngineNotRenderingRefusal.ts` shares this same constant
 * to strip it back off before the reason reaches a musician.
 */
export const ENGINE_NOT_RENDERING_PREFIX = 'engine-not-rendering:';

export function isEngineNotRenderingRefusal(reason: string): boolean {
    return reason.startsWith(ENGINE_NOT_RENDERING_PREFIX);
}
