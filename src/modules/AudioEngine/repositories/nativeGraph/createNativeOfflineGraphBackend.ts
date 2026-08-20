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
 * rejected batch leaves the backend exactly as it was — the same whole-or-
 * nothing law `apply_graph_commands` keeps on the live path.
 *
 * An offline backend deliberately never calls `apply_graph_commands`: that
 * command lazily starts the live CPAL engine (#1984), and a bounce must not
 * open an audio device. Live adoption is the D3.c cutover (#2214).
 *
 * ── The strip reports ─────────────────────────────────────────────────────
 *
 * `render_graph_offline` answers PCM, not reports, so an accepted batch's
 * reports are derived here from the one law `map_device` applies to a batch
 * it *accepts*: a device is built exactly when it is the built-in Knead
 * engine and not an externally hosted plugin. Every other pairing either
 * refused the batch (a non-realisable device on a contributing strip, an
 * external plugin anywhere) — unreachable in an accepted batch — or degraded
 * (a non-realisable device on a non-contributing strip), which the contract
 * defines as absent from the report. The restatement is guarded by the null
 * test's presence pins, which read these reports.
 */

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphCommand,
    type AudioGraphCommandBatch,
    type AudioGraphCorrelation,
    type AudioGraphStripReport,
} from '../../models/AudioGraphBackend';
import { type Device } from '../../models/TrackViewTypes';

import { collectBufferedClipSources } from './collectBufferedClipSources';
import { deinterleaveStereoPcm, type PlanarStereo } from './deinterleaveStereoPcm';
import { interleaveAudioBufferPcm } from './interleaveAudioBufferPcm';
import { type NativeGraphTransport } from './nativeGraphTransport';
import {
    serializeAudioGraphCommand,
    type NativeGraphWireBatch,
    type NativeGraphWireCommand,
} from './serializeAudioGraphCommand';

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
    /** Source ids whose material reached the native pool through this backend. */
    const registeredSourceIds = new Set<string>();
    let correlation: AudioGraphCorrelation | undefined;
    let runtimeRevision = 0;
    let disposed = false;

    function wireBatch(commands: readonly NativeGraphWireCommand[]): NativeGraphWireBatch {
        return {
            schemaVersion: 1,
            ...(correlation ? { correlation } : {}),
            commands,
        };
    }

    return {
        backendId: NATIVE_OFFLINE_BACKEND_ID,

        async apply(batch: AudioGraphCommandBatch): Promise<AudioGraphApplyResult> {
            if (disposed) {
                return rejected('backend disposed');
            }
            if (batch.schemaVersion !== 1) {
                return rejected(`unsupported command schema version ${String(batch.schemaVersion)}`);
            }

            const incoming = batch.commands.map(serializeAudioGraphCommand);

            // Material first: the wire carries only identities, and a
            // `schedule-clip` the probe maps must find its sample in the pool.
            // A source with no buffer is passed through untouched — the pool
            // may already hold it — and one the pool does not hold is refused
            // by the probe, by name, never played as silence.
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
                registeredSourceIds.add(source.sourceId);
            }

            // The whole-batch probe (see the header). One frame maps and
            // validates everything applied so far plus this batch; a refusal
            // reaches the caller as the native side's own reasons and commits
            // nothing.
            try {
                await transport.renderGraphOffline({
                    batch: wireBatch([...wireCommands, ...incoming]),
                    frames: 1,
                    sampleRate,
                });
            } catch (error) {
                return rejected(reasonOf(error));
            }

            wireCommands = [...wireCommands, ...incoming];
            if (batch.correlation) {
                correlation = batch.correlation;
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
            const bytes = await transport.renderGraphOffline({
                batch: wireBatch(wireCommands),
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
