/**
 * The live native engine, behind {@link AudioGraphBackend} (#3066, D3.c.4a).
 *
 * The offline sibling in this directory probes through `map_graph_batch` and
 * renders nothing; this one is the other half of the same seam: it applies a
 * batch to the **running** engine through `apply_graph_commands`. That command
 * is also the engine's bootstrap — `daw-engine` spawns its audio stream on the
 * first batch (#1984) — so the first `apply` a session makes is what starts the
 * native engine, and a machine where it cannot start answers `rejected` with an
 * `engine-not-running:` reason rather than throwing.
 *
 * ── Why so little happens here ────────────────────────────────────────────
 *
 * Everything law-bearing already lives on one side of this file or the other.
 * The commands are built by the producer
 * (`useCases/livePlayback/projectLiveGraphTopology.ts`); the wire mirror is
 * `serializeAudioGraphCommandBatch`; the validation, the whole-or-nothing
 * admission and the strip reports are the native side's. What is left is the
 * result vocabulary, and this file's whole job is to refuse to invent one:
 * `apply_graph_commands` answers exactly `rejected`, accepted+`applied` and
 * accepted+`needs-reconcile`, and any other shape is a seam defect that throws
 * rather than passing as a result.
 *
 * ── Errors are refusals, defects throw ────────────────────────────────────
 *
 * A transport failure becomes `rejected` with the error's message, the same law
 * the offline backend's `apply` keeps: the contract has one failure vocabulary,
 * and a caller that must decide whether to engage the native engine reads a
 * reason either way. A *malformed* answer is not a failure the batch asked for,
 * so it throws — a caller cannot degrade sensibly against a seam it can no
 * longer read.
 *
 * ── No sample pool ───────────────────────────────────────────────────────
 *
 * This slice's producer emits no `schedule-clip`, so nothing here registers
 * timeline material. When a live programme arrives, clip material has to reach
 * `register_timeline_sample` **before** the batch that references it — the
 * ordering the offline backend already keeps — and it must not be paid for at
 * the play gesture, because a project's decoded PCM is far too large to push
 * across the bridge while a musician waits for the first frame.
 */

import {
    type AudioGraphApplyResult,
    type AudioGraphAttachedPlugin,
    type AudioGraphBackend,
    type AudioGraphCommandBatch,
} from '../../models/AudioGraphBackend';

import { type NativeGraphTransport } from './nativeGraphTransport';
import { readNativeStripReports } from './readNativeStripReports';
import { serializeAudioGraphCommandBatch } from './serializeAudioGraphCommandBatch';

export const NATIVE_LIVE_BACKEND_ID = 'native/live';

export type NativeLiveGraphBackendDeps = Readonly<{
    /**
     * The command carrier: `createDesktopNativeGraphTransport()` in
     * production, a stub in tests. Everything with a law in it happens on this
     * side of it.
     */
    transport: NativeGraphTransport;
}>;

function rejected(reason: string): AudioGraphApplyResult {
    return { acceptance: 'rejected', application: 'not-applied', reason };
}

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readNumber(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`apply_graph_commands answered a malformed ${field}: ${JSON.stringify(value)}`);
    }
    return value;
}

/**
 * Read the instances `apply_graph_commands` says its engine start took over.
 *
 * Absent is empty, not malformed: the field is carried only by an applied batch
 * that ran a start, and a payload without one attached nothing. An entry that
 * does not name an instance and a bridge depth is dropped rather than guessed
 * at — the depth is added to a latency figure, and a substituted zero is a
 * compensation error nothing downstream can see.
 */
function readAttachedPlugins(value: unknown): readonly AudioGraphAttachedPlugin[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((entry) => {
        const attached = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
        const instanceId = attached?.instanceId;
        const bridgeRoundTripFrames = attached?.bridgeRoundTripFrames;
        if (typeof instanceId !== 'string' || typeof bridgeRoundTripFrames !== 'number') {
            return [];
        }
        if (!Number.isFinite(bridgeRoundTripFrames)) {
            return [];
        }
        return [{ instanceId, bridgeRoundTripFrames }];
    });
}

/**
 * Read `apply_graph_commands`'s mirror of {@link AudioGraphApplyResult}.
 *
 * The correlation is echoed verbatim by the native side, so it is carried back
 * only when the batch itself asked for one — restating it from the request
 * would make an echo the caller can no longer distinguish from a claim.
 */
function readAppliedResult(value: unknown, batch: AudioGraphCommandBatch): AudioGraphApplyResult {
    const payload = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
    if (payload?.acceptance === 'rejected') {
        const reason = payload.reason;
        return rejected(typeof reason === 'string' ? reason : 'refused without a reason');
    }
    // The outcome is decided before any of its payload is read, so an answer
    // in no known shape is reported as the unknown outcome it is rather than as
    // whichever field a half-read outcome happened to miss.
    const applied = payload?.acceptance === 'accepted' && payload.application === 'applied';
    const needsReconcile = payload?.acceptance === 'accepted' && payload.application === 'needs-reconcile';
    if (!payload || (!applied && !needsReconcile)) {
        throw new Error(`apply_graph_commands answered an unknown outcome: ${JSON.stringify(value)}`);
    }
    const correlation = batch.correlation ? { correlation: batch.correlation } : {};
    const reports = readNativeStripReports(payload.reports, 'apply_graph_commands');
    const runtimeRevision = readNumber(payload.runtimeRevision, 'runtimeRevision');
    if (applied) {
        // Optional on the wire and optional here: the native side omits it for
        // any outcome whose fence the engine will never drain, and a default
        // stood in for it would be a number promising a drain that is not
        // coming.
        const admitted = payload.admittedBatch;
        const admittedBatch =
            typeof admitted === 'number' && Number.isFinite(admitted) ? { admittedBatch: admitted } : {};
        return {
            acceptance: 'accepted',
            application: 'applied',
            ...correlation,
            runtimeRevision,
            ...admittedBatch,
            reports,
            attachedPlugins: readAttachedPlugins(payload.attachedPlugins),
        };
    }
    const reason = payload.reason;
    return {
        acceptance: 'accepted',
        application: 'needs-reconcile',
        // Whether compensation was even attempted is the native side's own
        // report; a reader that assumed one would claim a graph was restored
        // that nothing ever restored.
        compensation: payload.compensation === 'failed' ? 'failed' : 'not-attempted',
        ...correlation,
        reason: typeof reason === 'string' ? reason : 'partially applied without a reason',
        runtimeRevision,
        reports,
    };
}

export function createNativeLiveGraphBackend(deps: NativeLiveGraphBackendDeps): AudioGraphBackend {
    const { transport } = deps;
    let disposed = false;

    return {
        backendId: NATIVE_LIVE_BACKEND_ID,

        async apply(batch: AudioGraphCommandBatch): Promise<AudioGraphApplyResult> {
            if (disposed) {
                return rejected('backend disposed');
            }
            if (batch.schemaVersion !== 1) {
                return rejected(`unsupported command schema version ${String(batch.schemaVersion)}`);
            }
            let raw: unknown;
            try {
                raw = await transport.applyGraphCommands({ batch: serializeAudioGraphCommandBatch(batch) });
            } catch (error) {
                return rejected(reasonOf(error));
            }
            return readAppliedResult(raw, batch);
        },

        dispose(): void {
            // The engine is process-wide and outlives this handle: it hosts the
            // plugin runtimes, and stopping it here would retire instances this
            // backend never owned. Disposal closes the handle, nothing else.
            disposed = true;
        },
    };
}
