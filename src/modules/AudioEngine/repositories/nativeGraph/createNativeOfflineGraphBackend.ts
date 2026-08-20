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
 * ── Why `apply` renders one frame ─────────────────────────────────────────
 *
 * The contract requires a batch to be refused **at apply time**, whole, before
 * any of it is applied — and the native side's validation (`map_batch`, with
 * every refusal reason this backend is accountable for: `stretched-clip-
 * unsupported`, `smoothed-write-unsupported`, `bus-to-track-routing-
 * unsupported`, the queue-capacity refusals) lives behind the render command.
 * So `apply` probes: it renders the accumulated batch at one frame, which maps
 * and validates every command against a fresh registry and costs one block of
 * arithmetic. A probe that refuses rolls the incoming commands back, so a
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
 * open an audio device. Live adoption is the D3.c cutover (#2223).
 *
 * ── The strip reports ─────────────────────────────────────────────────────
 *
 * `render_graph_offline` answers PCM, not reports, so an accepted batch's
 * reports are a **TS-side restatement**, computed here from the caller's own
 * commands by mirroring the one law `map_device` applies to a batch it
 * *accepts*: a device is built exactly when it is the built-in Knead engine
 * and not an externally hosted plugin. Every other pairing either refused the
 * batch (a non-realisable device on a contributing strip, an external plugin
 * anywhere) — unreachable in an accepted batch — or degraded (a
 * non-realisable device on a non-contributing strip), which the contract
 * defines as absent from the report. The contract calls `deviceIds` an
 * observation; this restatement observes nothing native and is unguarded
 * against native drift until reports cross the wire. What actually covers
 * strip presence today is the null test's audio residual plus the offline
 * diagnostics backstop (`offline-render-dropped-commands` in `graph.rs`).
 * Carrying native reports across the wire lands with the D3.c cutover
 * (jcosta33/sourdaw#2223), when reports become production-consumed.
 */

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommand,
    type AudioGraphCommandBatch,
    type AudioGraphStripReport,
} from '../../models/AudioGraphBackend';
import { type Device } from '../../models/TrackViewTypes';

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

/**
 * Whether an accepted batch's device is in the built chain — the TS
 * restatement of `map_device`'s law for accepted batches (see the header).
 */
function isNativelyRealizedDevice(device: Device): boolean {
    return (
        device.externalPluginId === undefined &&
        device.externalInstanceId === undefined &&
        device.type.toLowerCase() === 'knead'
    );
}

function deriveStripReports(commands: readonly AudioGraphCommand[]): AudioGraphStripReport[] {
    const reports: AudioGraphStripReport[] = [];
    for (const command of commands) {
        if (command.kind !== 'create-track-strip' && command.kind !== 'create-bus-strip') {
            continue;
        }
        reports.push({
            kind: command.kind === 'create-track-strip' ? 'track' : 'bus',
            id: command.kind === 'create-track-strip' ? command.trackId : command.busId,
            deviceIds: command.devices.filter(isNativelyRealizedDevice).map((device) => device.id),
        });
    }
    return reports;
}

function rejected(reason: string): AudioGraphApplyResult {
    return { acceptance: 'rejected', application: 'not-applied', reason };
}

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

            // The whole-batch probe (see the header). One frame maps and
            // validates everything applied so far plus this batch; a refusal
            // reaches the caller as the native side's own reasons and commits
            // nothing. Cost note: every probe re-serializes and re-sends the
            // whole accumulated command list, so a bounce of N batches crosses
            // the wire O(N²) commands in total. Harmless at bounce sizes
            // today; the D3.c consumer (#2223) must either diff batches or cap
            // the accumulation before adopting this path for live-sized runs.
            try {
                await transport.renderGraphOffline({
                    batch: { ...incoming, commands: [...wireCommands, ...incoming.commands] },
                    frames: 1,
                    sampleRate,
                });
            } catch (error) {
                return rejected(reasonOf(error));
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
                reports: deriveStripReports(batch.commands),
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
