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

import { type NativeLevainBankLayout } from '../../models/NativeSampleBank';

import { type NativeGraphWireBatch, type NativeGraphWireCommand } from './serializeAudioGraphCommand';

// The bank vocabulary is a model rather than this file's own, because the
// registration that stages a bank and the runtime sink that leases one read it
// too. Re-exported here so the seam still names the whole of what crosses it.
export type {
    NativeLevainBankLayout,
    NativeLevainLegatoTransition,
    NativeLevainZone,
} from '../../models/NativeSampleBank';

/**
 * Names one backend's mapping session on the native side (`MappingSessionKeyPayload`
 * in `crates/sourdaw-native/src/commands/graph.rs`): the kept probe registry
 * that lets `prior` stay empty across one render's applies. `revision` is how
 * many commands the caller has had accepted — the history the kept registry
 * must represent for a resume to be sound.
 */
export type MapGraphSessionKey = Readonly<{
    sessionId: string;
    revision: number;
}>;

export type RegisterTimelineSampleInput = Readonly<{
    sampleId: string;
    /** The material's own rate; the engine rate-converts at playback. */
    sampleRate: number;
    channels: 1 | 2;
    /** Interleaved f32 little-endian. */
    pcm: Uint8Array;
}>;

export type BeginLevainBankInput = Readonly<{
    /** Names the bank on the native side, as the worklet cache keys it. */
    bankKey: string;
    instrumentId: string;
}>;

export type RegisterLevainSampleInput = Readonly<{
    bankKey: string;
    /** The renderer's own id for this file, which the layout's zones name. */
    sampleId: string;
    /** The material's own rate; the native side converts at build time. */
    sampleRate: number;
    channels: 1 | 2;
    /** Interleaved f32 little-endian. */
    pcm: Uint8Array;
}>;

export type CommitLevainBankInput = Readonly<{
    bankKey: string;
    layout: NativeLevainBankLayout;
}>;

export type ReleaseLevainBankInput = Readonly<{
    /** The key the bank was opened under; releasing an unheld key is not an error. */
    bankKey: string;
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
     * what scopes the result's reports to the incoming batch alone. Empty
     * when `session` resumes that history natively instead.
     */
    prior: readonly NativeGraphWireCommand[];
    batch: NativeGraphWireBatch;
    sampleRate: number;
    /**
     * Resumable prior (#2225): with a key, the native side keeps the mapped
     * registry under `sessionId` so the next apply's `prior` stays empty. A
     * session the native side no longer holds is a transport error opening
     * with the seam's session-fault prefix; the caller re-establishes by
     * resending its full prior under the same key. Absent or `null` is the
     * stateless behaviour.
     */
    session?: MapGraphSessionKey | null;
}>;

export type NativeGraphTransport = Readonly<{
    /** `register_timeline_sample`: decoded material into the native pool. */
    registerTimelineSample: (input: RegisterTimelineSampleInput) => Promise<unknown>;
    /**
     * `begin_levain_bank`: open an empty bank under `bankKey`, replacing any
     * bank already registered there. The first of the three-step stage a
     * native Levain device's body is built from.
     */
    beginLevainBank: (input: BeginLevainBankInput) => Promise<unknown>;
    /** `register_levain_sample`: one decoded file into a staged bank. */
    registerLevainSample: (input: RegisterLevainSampleInput) => Promise<unknown>;
    /**
     * `commit_levain_bank`: close a staged bank against its zone layout. Only
     * after this does a device naming `bankKey` map onto a built instrument.
     */
    commitLevainBank: (input: CommitLevainBankInput) => Promise<unknown>;
    /**
     * `release_levain_bank`: drop a staged bank and every conversion of it.
     * The native store never evicts, so this is what ends a bank's life there
     * — called when the renderer's own lease on the instrument ends.
     */
    releaseLevainBank: (input: ReleaseLevainBankInput) => Promise<unknown>;
    /**
     * `render_graph_offline`: one deterministic render, no live engine.
     * Answers interleaved stereo f32 LE bytes; a refused batch is a thrown
     * error carrying the native side's per-command refusal reasons.
     */
    renderGraphOffline: (input: RenderGraphOfflineInput) => Promise<Uint8Array>;
    /**
     * `apply_graph_commands`: one batch onto the **live** native engine, which
     * lazily starts on the first batch. Never called by the offline backend —
     * a bounce must not open an audio device — and reached in production only
     * through `createNativeLiveGraphBackend`, whose session the transport
     * gestures drive (#3066).
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
        async beginLevainBank({ bankKey, instrumentId }) {
            return desktopInvoke('begin_levain_bank', { bankKey, instrumentId });
        },
        async registerLevainSample({ bankKey, sampleId, sampleRate, channels, pcm }) {
            // The trailing byte payload routes through the bridge's binary
            // path, exactly as the timeline sample above does.
            return desktopInvoke('register_levain_sample', { bankKey, sampleId, sampleRate, channels, pcm });
        },
        async commitLevainBank({ bankKey, layout }) {
            return desktopInvoke('commit_levain_bank', { bankKey, layout });
        },
        async releaseLevainBank({ bankKey }) {
            return desktopInvoke('release_levain_bank', { bankKey });
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
        async mapGraphBatch({ prior, batch, sampleRate, session }) {
            // Explicit `null` rather than an absent key: the seam orders named
            // arguments positionally, and the addon reads null as "no session".
            return desktopInvoke('map_graph_batch', { prior, batch, sampleRate, session: session ?? null });
        },
    };
}
