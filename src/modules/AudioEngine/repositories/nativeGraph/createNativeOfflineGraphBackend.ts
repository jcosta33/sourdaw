/**
 * The native offline renderer, behind {@link AudioGraphBackend}.
 *
 * The rendering body is `daw-engine`'s timeline graph, reached through
 * `render_graph_offline` — the same scheduler the live CPAL callback drives,
 * with the calling thread standing in for the device (`crates/daw-engine/src/
 * offline.rs`). This file owns the TypeScript half: serialize contract batches
 * onto the wire mirror in `crates/sourdaw-native/src/commands/graph.rs`,
 * register clip material into the native sample pool, and drive the render.
 *
 * ── Why `apply` maps, and renders nothing ─────────────────────────────────
 *
 * The contract requires a batch to be refused **at apply time**, whole, before
 * any of it is applied — and the native side's validation (`map_batch`, with
 * every refusal reason this backend is accountable for: `stretched-clip-
 * unsupported`, `smoothed-write-unsupported`, `bus-to-track-routing-
 * unsupported`, the queue-capacity refusals) lives on the native side. So
 * `apply` probes through `map_graph_batch`: the commands committed so far
 * replay as the prior graph, the incoming batch maps against it, and the
 * answer is the native apply-result itself — refusal reasons and strip
 * reports — with nothing rendered. A probe that refuses commits nothing, so a
 * rejected batch changes nothing this backend will ever render — the same
 * whole-or-nothing law `apply_graph_commands` keeps on the live path. One
 * honest caveat: clip material is sent to the native sample pool *before* the
 * probe, because a `schedule-clip` the probe maps must find its sample there.
 * The pool is process-wide and identity-keyed with replace semantics, so a
 * refused batch may leave material in it; the backend forgets those ids on
 * refusal and a retry simply re-registers the same bytes under the same
 * identity.
 *
 * An offline backend deliberately never calls `apply_graph_commands`: that
 * command lazily starts the live CPAL engine (#1984), and a bounce must not
 * open an audio device. Live adoption is the D3.c.2 cutover (#2225).
 *
 * ── The strip reports ─────────────────────────────────────────────────────
 *
 * Reports are the native mapping's own observations, carried across the wire:
 * the same touched-strip reports `graph.rs` builds from its post-batch
 * registry on the live path, scoped to the incoming batch by the
 * prior/incoming split of `map_graph_batch`. Nothing is restated TS-side —
 * a device the native side degraded is absent because the native side
 * observed it absent. The `runtimeRevision` in the result stays this
 * backend's own counter: a mapping has no runtime, so the wire result
 * deliberately carries none.
 */

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommandBatch,
    type AudioGraphStripReport,
} from '../../models/AudioGraphBackend';

import { collectBufferedClipSources } from './collectBufferedClipSources';
import { deinterleaveStereoPcm, type PlanarStereo } from './deinterleaveStereoPcm';
import { interleaveAudioBufferPcm } from './interleaveAudioBufferPcm';
import { type NativeGraphTransport } from './nativeGraphTransport';
import { type NativeGraphWireCommand } from './serializeAudioGraphCommand';
import { serializeAudioGraphCommandBatch } from './serializeAudioGraphCommandBatch';

export const NATIVE_OFFLINE_BACKEND_ID = 'native/offline';

export type NativeOfflineGraphBackendDeps = Readonly<{
    /** The render's rate; every batch time is mapped to frames against it. */
    sampleRate: number;
    /**
     * The command carrier: `createDesktopNativeGraphTransport()` in
     * production, the built addon in-process in the null test. Everything
     * law-bearing happens on this side of it.
     */
    transport: NativeGraphTransport;
}>;

export type NativeOfflineGraphBackend = AudioGraphBackend &
    Readonly<{
        /**
         * Render everything applied so far. The implementation's own surface,
         * beside the contract, exactly as the web backend's node accessors
         * are: the contract routes commands, and what a caller then does with
         * the built graph is the implementation's vocabulary.
         */
        render: (frames: number) => Promise<PlanarStereo>;
    }>;

function rejected(reason: string): AudioGraphApplyResult {
    return { acceptance: 'rejected', application: 'not-applied', reason };
}

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
        return null;
    }
    const out: string[] = [];
    for (const entry of value as readonly unknown[]) {
        if (typeof entry !== 'string') {
            return null;
        }
        out.push(entry);
    }
    return out;
}

function readStripReports(value: unknown): AudioGraphStripReport[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`map_graph_batch answered without reports: ${JSON.stringify(value)}`);
    }
    return (value as readonly unknown[]).map((entry) => {
        const report = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
        const kind = report?.kind;
        const id = report?.id;
        const deviceIds = readStringArray(report?.deviceIds);
        if ((kind !== 'track' && kind !== 'bus') || typeof id !== 'string' || deviceIds === null) {
            throw new Error(`map_graph_batch answered a malformed strip report: ${JSON.stringify(entry)}`);
        }
        return { kind, id, deviceIds };
    });
}

type MappedOutcome =
    | Readonly<{ outcome: 'rejected'; reason: string }>
    | Readonly<{ outcome: 'mapped'; reports: readonly AudioGraphStripReport[] }>;

/**
 * Read the mapping wire's apply-result mirror. It speaks exactly two
 * outcomes — `rejected` and accepted+`applied` — so any other shape is a
 * seam defect and throws rather than passing as a result.
 */
function readMappedResult(value: unknown): MappedOutcome {
    const payload = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
    if (payload?.acceptance === 'rejected') {
        const reason = payload.reason;
        return {
            outcome: 'rejected',
            reason: typeof reason === 'string' ? reason : 'refused without a reason',
        };
    }
    if (payload?.acceptance === 'accepted' && payload.application === 'applied') {
        return { outcome: 'mapped', reports: readStripReports(payload.reports) };
    }
    throw new Error(`map_graph_batch answered an unknown outcome: ${JSON.stringify(value)}`);
}

export function createNativeOfflineGraphBackend(deps: NativeOfflineGraphBackendDeps): NativeOfflineGraphBackend {
    const { sampleRate, transport } = deps;

    /** Every command accepted so far, in application order, wire-shaped. */
    let wireCommands: NativeGraphWireCommand[] = [];
    /** Source ids of material an *accepted* batch put in the native pool. */
    const registeredSourceIds = new Set<string>();
    let runtimeRevision = 0;
    let disposed = false;

    return {
        backendId: NATIVE_OFFLINE_BACKEND_ID,

        async apply(batch: AudioGraphCommandBatch): Promise<AudioGraphApplyResult> {
            if (disposed) {
                return rejected('backend disposed');
            }
            if (batch.schemaVersion !== 1) {
                return rejected(`unsupported command schema version ${String(batch.schemaVersion)}`);
            }

            // The envelope is the applied batch's own — `schemaVersion` and
            // `correlation` cross the wire exactly as this batch carries them,
            // and an absent correlation stays absent (the serializer's law).
            const incoming = serializeAudioGraphCommandBatch(batch);

            // Material first: the wire carries only identities, and a
            // `schedule-clip` the probe maps must find its sample in the pool.
            // A source with no buffer is passed through untouched — the pool
            // may already hold it — and one the pool does not hold is refused
            // by the probe, by name, never played as silence. The ids are
            // remembered only after the probe accepts (see the header's
            // rollback caveat).
            const sentSourceIds: string[] = [];
            for (const source of collectBufferedClipSources(batch.commands)) {
                if (registeredSourceIds.has(source.sourceId)) {
                    continue;
                }
                try {
                    const material = interleaveAudioBufferPcm(source);
                    await transport.registerTimelineSample({
                        sampleId: source.sourceId,
                        sampleRate: source.buffer.sampleRate,
                        channels: material.channels,
                        pcm: material.pcm,
                    });
                } catch (error) {
                    return rejected(`register_timeline_sample "${source.sourceId}": ${reasonOf(error)}`);
                }
                sentSourceIds.push(source.sourceId);
            }

            // The whole-batch probe (see the header): the committed commands
            // replay as the prior graph, the incoming batch maps against it,
            // nothing renders. A refusal is the native side's own reasons and
            // commits nothing; an acceptance carries the native reports. Cost
            // note: every probe re-serializes and re-sends the whole
            // accumulated command list, so a bounce of N batches crosses the
            // wire O(N²) commands in total. Harmless at bounce sizes today;
            // the D3.c.2 consumer (#2225) must either diff batches or cap the
            // accumulation before adopting this path for live-sized runs.
            let mappedRaw: unknown;
            try {
                mappedRaw = await transport.mapGraphBatch({
                    prior: wireCommands,
                    batch: incoming,
                    sampleRate,
                });
            } catch (error) {
                return rejected(reasonOf(error));
            }
            const mapped = readMappedResult(mappedRaw);
            if (mapped.outcome === 'rejected') {
                return rejected(mapped.reason);
            }

            wireCommands = [...wireCommands, ...incoming.commands];
            for (const sourceId of sentSourceIds) {
                registeredSourceIds.add(sourceId);
            }
            runtimeRevision += 1;
            return {
                acceptance: 'accepted',
                application: 'applied',
                ...(batch.correlation ? { correlation: batch.correlation } : {}),
                runtimeRevision,
                reports: mapped.reports,
            };
        },

        async render(frames: number): Promise<PlanarStereo> {
            if (disposed) {
                throw new Error('native offline backend disposed');
            }
            // Deliberately not caught: after every batch was accepted whole, a
            // refusal here describes the render request or the runtime, not a
            // command, and folding it into silence would hand back a file that
            // is not the project.
            //
            // The render envelope carries no correlation: correlation is a
            // per-batch staleness key, echoed at apply time on each batch's own
            // probe, and this render applies no batch. `schemaVersion` is the
            // wire schema this file speaks — `apply` refused anything else.
            const bytes = await transport.renderGraphOffline({
                batch: { schemaVersion: 1, commands: wireCommands },
                frames,
                sampleRate,
            });
            return deinterleaveStereoPcm({ bytes, frames });
        },

        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            // The sample pool is deliberately left alone: ids name decoded
            // identities and re-registration replaces, so entries cannot go
            // stale — and the pool is process-wide, not this backend's.
            wireCommands = [];
        },
    };
}
