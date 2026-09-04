/**
 * Bridge-cost sinks for live native plugin instances, keyed by instance id.
 *
 * The sibling of {@link externalLatencyReporters}, and kept for the same
 * reason: the figure is reported once at activation, but an instance loaded
 * before any engine was running has no bridge yet, so its real cost only exists
 * once a graph batch starts an engine and takes the instance over. That report
 * arrives on the batch's result rather than through the activation that asked
 * for it, so the sink has to outlive the call — a caller cannot be handed a
 * number by a promise that already resolved.
 *
 * Values are frames of the engine rate this instance was activated with.
 *
 * Ephemeral runtime state, not project truth. Cleared with the activation guard
 * set when the audio graph is torn down.
 */
export const externalBridgeFramesReporters = new Map<string, (frames: number) => void>();
