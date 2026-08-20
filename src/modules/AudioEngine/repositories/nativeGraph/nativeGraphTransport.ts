/**
 * The repository root for the native graph commands, and the transport seam
 * the native backend renders through.
 *
 * `NativeGraphTransport` exists so the *same* backend body — and therefore the
 * same serializer — can be driven over two carriers: the desktop bridge in
 * production (this file), and the built addon in-process in the null test
 * (`liveOfflineNullTest.spec.ts`). The seam carries already-serialized wire
 * payloads only; everything with a law in it (buffer stripping, PCM encoding,
 * result derivation) lives on the backend side of the seam, so swapping the
 * carrier cannot change what crosses.
 */

import { desktopInvoke, invokeForBinaryResponse } from '#/utils/desktopBridge';

import { type NativeGraphWireBatch, type NativeGraphWireCommand } from './serializeAudioGraphCommand';

export type RegisterTimelineSampleInput = Readonly<{
    sampleId: string;
    /** The material's own rate; the engine rate-converts at playback. */
    sampleRate: number;
    channels: 1 | 2;
    /** Interleaved f32 little-endian. */
    pcm: Uint8Array;
}>;

export type RenderGraphOfflineInput = Readonly<{
    batch: NativeGraphWireBatch;
    frames: number;
    sampleRate: number;
}>;

export type ApplyGraphCommandsInput = Readonly<{
    batch: NativeGraphWireBatch;
}>;

export type MapGraphBatchInput = Readonly<{
    /**
     * The already-committed wire commands the incoming batch maps after —
     * what scopes the result's reports to the incoming batch alone.
     */
    prior: readonly NativeGraphWireCommand[];
    batch: NativeGraphWireBatch;
    sampleRate: number;
}>;

export type NativeGraphTransport = Readonly<{
    /** `register_timeline_sample`: decoded material into the native pool. */
    registerTimelineSample: (input: RegisterTimelineSampleInput) => Promise<unknown>;
    /**
     * `render_graph_offline`: one deterministic render, no live engine.
     * Answers interleaved stereo f32 LE bytes; a refused batch is a thrown
     * error carrying the native side's per-command refusal reasons.
     */
    renderGraphOffline: (input: RenderGraphOfflineInput) => Promise<Uint8Array>;
    /**
     * `apply_graph_commands`: one batch onto the **live** native engine, which
     * lazily starts on the first batch. Not called by the offline backend —
     * live adoption is the D3.c.2 cutover (#2225) — but carried on the seam so
     * the cutover swaps a call site, not the transport.
     */
    applyGraphCommands: (input: ApplyGraphCommandsInput) => Promise<unknown>;
    /**
     * `map_graph_batch`: validate one batch against the graph the prior
     * commands built and answer the native apply-result — refusal reasons
     * and touched-strip reports — with nothing rendered. The offline
     * backend's admission probe and its report wire.
     */
    mapGraphBatch: (input: MapGraphBatchInput) => Promise<unknown>;
}>;

/** The production carrier: the graph commands over the desktop bridge. */
export function createDesktopNativeGraphTransport(): NativeGraphTransport {
    return {
        async registerTimelineSample({ sampleId, sampleRate, channels, pcm }) {
            // The trailing byte payload routes through the bridge's binary
            // path; the seam orders the named arguments positionally.
            return desktopInvoke('register_timeline_sample', { sampleId, sampleRate, channels, pcm });
        },
        async renderGraphOffline({ batch, frames, sampleRate }) {
            return invokeForBinaryResponse({
                command: 'render_graph_offline',
                args: { batch, frames, sampleRate },
            });
        },
        async applyGraphCommands({ batch }) {
            return desktopInvoke('apply_graph_commands', { batch });
        },
        async mapGraphBatch({ prior, batch, sampleRate }) {
            return desktopInvoke('map_graph_batch', { prior, batch, sampleRate });
        },
    };
}
