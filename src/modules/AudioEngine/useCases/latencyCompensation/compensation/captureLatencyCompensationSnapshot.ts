import { trackStore } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';

import { type TrackLatency } from '../../../models/LatencyCompensationTypes';
import { getAudioContext } from '../../engineAccess/getAudioContext';

import { externalLatencyRegistry } from './externalLatencyRegistry';
import { getDeviceLatencyMs } from './getDeviceLatencyMs';

type Track = NonNullable<typeof trackStore.value>['tracks'][number];
type SidechainRoutes = NonNullable<typeof sidechainStore.value>['routes'];
type LatencyTopologyTrack = {
    id: string;
    outputId: string | undefined;
    sendTargetIds: string[];
    devices: { id: string; latencyMs: number }[];
    deviceLatencyMs: number;
};
type TraversalContext = {
    visiting: Set<string>;
    cycles: number;
};

function buildLatencyCompensationSnapshot({
    tracks,
    sidechainRoutes,
}: {
    tracks: readonly Track[];
    sidechainRoutes: SidechainRoutes;
}) {
    const trackById = new Map<string, LatencyTopologyTrack>();
    const downstreamSidechainsByTrackId = new Map<string, string[]>();
    const trackLatencyById = new Map<string, TrackLatency>();
    let capturedSampleRate: number | undefined;

    for (const track of tracks) {
        let trackDeviceLatencyMs = 0;
        const devices: LatencyTopologyTrack['devices'] = [];
        for (const device of track.devices) {
            let deviceLatencyMs = 0;
            if (!device.bypassed) {
                const needsSampleRate =
                    device.type === 'builtin-sidechain-compressor' && !externalLatencyRegistry.has(device.id);
                if (needsSampleRate) {
                    if (capturedSampleRate === undefined) {
                        capturedSampleRate = getAudioContext().sampleRate;
                    }
                    deviceLatencyMs = getDeviceLatencyMs(device.id, device.type, capturedSampleRate);
                } else {
                    deviceLatencyMs = getDeviceLatencyMs(device.id, device.type);
                }
                trackDeviceLatencyMs += deviceLatencyMs;
            }
            devices.push({ id: device.id, latencyMs: deviceLatencyMs });
        }
        trackById.set(track.id, {
            id: track.id,
            outputId: track.outputId,
            sendTargetIds: track.sends.map((send) => send.busId),
            devices,
            deviceLatencyMs: trackDeviceLatencyMs,
        });
    }

    for (const route of sidechainRoutes) {
        const targets = downstreamSidechainsByTrackId.get(route.sourceTrackId);
        if (targets) {
            targets.push(route.targetTrackId);
        } else {
            downstreamSidechainsByTrackId.set(route.sourceTrackId, [route.targetTrackId]);
        }
    }

    // Track outputs, sends, and sidechains are rejected at their mutation
    // boundaries when they would close a cycle, so this memoized DAG traversal
    // resolves each track once. The visiting guard still terminates legacy or
    // externally-authored corrupt project data.
    function resolveTrackLatency(trackId: string, traversal: TraversalContext): TrackLatency {
        const cached = trackLatencyById.get(trackId);
        if (cached) {
            return cached;
        }

        const track = trackById.get(trackId);
        if (!track) {
            return Object.freeze({ trackId, deviceLatencyMs: 0, totalLatencyMs: 0 });
        }
        if (traversal.visiting.has(trackId)) {
            traversal.cycles += 1;
            return Object.freeze({ trackId, deviceLatencyMs: 0, totalLatencyMs: 0 });
        }

        const cyclesBeforeTrack = traversal.cycles;
        traversal.visiting.add(trackId);
        let maxDownstreamMs = 0;

        if (track.outputId && track.outputId !== 'hw_out') {
            maxDownstreamMs = Math.max(maxDownstreamMs, resolveTrackLatency(track.outputId, traversal).totalLatencyMs);
        }

        for (const sendTargetId of track.sendTargetIds) {
            maxDownstreamMs = Math.max(maxDownstreamMs, resolveTrackLatency(sendTargetId, traversal).totalLatencyMs);
        }

        for (const targetTrackId of downstreamSidechainsByTrackId.get(trackId) ?? []) {
            maxDownstreamMs = Math.max(maxDownstreamMs, resolveTrackLatency(targetTrackId, traversal).totalLatencyMs);
        }

        traversal.visiting.delete(trackId);
        const deviceLatencyMs = track.deviceLatencyMs;
        const latency: TrackLatency = Object.freeze({
            trackId,
            deviceLatencyMs,
            totalLatencyMs: deviceLatencyMs + maxDownstreamMs,
        });
        if (traversal.cycles === cyclesBeforeTrack) {
            trackLatencyById.set(trackId, latency);
        }
        return latency;
    }

    function getTrackLatency(trackId: string): TrackLatency {
        const cached = trackLatencyById.get(trackId);
        if (cached) {
            return cached;
        }
        return resolveTrackLatency(trackId, { visiting: new Set<string>(), cycles: 0 });
    }

    let maxTrackLatencyMs = 0;
    const traversal: TraversalContext = { visiting: new Set<string>(), cycles: 0 };
    for (const track of tracks) {
        maxTrackLatencyMs = Math.max(maxTrackLatencyMs, resolveTrackLatency(track.id, traversal).totalLatencyMs);
    }

    function getCompensationDelay(trackId: string): number {
        return (maxTrackLatencyMs - getTrackLatency(trackId).totalLatencyMs) / 1000;
    }

    function getSidechainKeyDelay({
        sourceTrackId,
        targetTrackId,
        targetDeviceId,
    }: {
        sourceTrackId: string;
        targetTrackId: string;
        targetDeviceId: string;
    }): number {
        const targetTrack = trackById.get(targetTrackId);
        if (!targetTrack) {
            return 0;
        }

        let upstreamOfDetectorMs = 0;
        for (const device of targetTrack.devices) {
            if (device.id === targetDeviceId) {
                break;
            }
            upstreamOfDetectorMs += device.latencyMs;
        }

        const keyChainMs = getTrackLatency(sourceTrackId).deviceLatencyMs;
        const programArrivalSec = getCompensationDelay(targetTrackId) + upstreamOfDetectorMs / 1000;
        const keyArrivalSec = getCompensationDelay(sourceTrackId) + keyChainMs / 1000;
        return Math.max(0, programArrivalSec - keyArrivalSec);
    }

    const snapshot = Object.freeze({
        getTrackLatency,
        getMaxTrackLatency: () => maxTrackLatencyMs,
        getCompensationDelay,
        getSidechainKeyDelay,
    });
    return { snapshot, sampleRate: capturedSampleRate };
}

type LatencyCompensationSnapshot = ReturnType<typeof buildLatencyCompensationSnapshot>['snapshot'];

let cachedProjection:
    | {
          tracks: WeakRef<readonly Track[]> | undefined;
          sidechainRoutes: WeakRef<SidechainRoutes> | undefined;
          hadTracks: boolean;
          hadSidechainRoutes: boolean;
          externalLatencyRevision: number;
          sampleRate: number | undefined;
          snapshot: LatencyCompensationSnapshot;
      }
    | undefined;

export function captureLatencyCompensationSnapshot(): LatencyCompensationSnapshot {
    // Store projections keep stable array identities until their authoritative
    // value changes. Weak cache keys avoid retaining an outgoing project's
    // clip-heavy rows, while the snapshot itself retains only minimal latency
    // topology. Native latency reports carry their own monotonic revision.
    // Unchanged scheduler ticks therefore reuse one immutable projection with no
    // graph rebuild or collection allocation.
    const tracks = trackStore.value?.tracks;
    const sidechainRoutes = sidechainStore.value?.routes;
    const externalLatencyRevision = externalLatencyRegistry.revision;
    let sampleRate: number | undefined;
    if (cachedProjection?.sampleRate !== undefined) {
        sampleRate = getAudioContext().sampleRate;
    }

    if (
        cachedProjection &&
        cachedProjection.hadTracks === (tracks !== undefined) &&
        cachedProjection.hadSidechainRoutes === (sidechainRoutes !== undefined) &&
        (!tracks || cachedProjection.tracks?.deref() === tracks) &&
        (!sidechainRoutes || cachedProjection.sidechainRoutes?.deref() === sidechainRoutes) &&
        cachedProjection.externalLatencyRevision === externalLatencyRevision &&
        cachedProjection.sampleRate === sampleRate
    ) {
        return cachedProjection.snapshot;
    }

    const built = buildLatencyCompensationSnapshot({
        tracks: tracks ?? [],
        sidechainRoutes: sidechainRoutes ?? [],
    });
    cachedProjection = {
        tracks: tracks ? new WeakRef(tracks) : undefined,
        sidechainRoutes: sidechainRoutes ? new WeakRef(sidechainRoutes) : undefined,
        hadTracks: tracks !== undefined,
        hadSidechainRoutes: sidechainRoutes !== undefined,
        externalLatencyRevision,
        sampleRate: built.sampleRate,
        snapshot: built.snapshot,
    };
    return built.snapshot;
}
