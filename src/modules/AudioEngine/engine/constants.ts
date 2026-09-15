/**
 * Channel-count law for the engine's device nodes: every built-in device
 * processes and emits stereo — one left/right pair per output. `channelCount`
 * and every entry of `outputChannelCount` state it, and the offline renderer
 * allocates the same pair, so a node that drifted to mono would silently
 * downmix its strip while export still recorded two channels.
 */
export const STEREO_CHANNEL_COUNT = 2;
