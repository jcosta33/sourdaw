import { sidechainStore } from '#/modules/Routing/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { type Track } from '../models/Track';
import { deriveEffectiveAudibility, type EffectiveAudibility } from '../stores/effectiveAudibility';
import { getTrackEligibility, shouldCreateLiveTrackStrip } from '../stores/trackEligibility';
import { trackStore } from '../stores/trackStore';

import { selectOfflineRenderSubgraph, type OfflineRenderSubgraph } from './selectOfflineRenderSubgraph';

type ResolveAgentMeasurementTargetsInput = { kind: 'master' } | { kind: 'tracks' | 'buses'; ids: readonly string[] };

type SidechainDetectorRoute = {
    sourceTrackId: string;
    targetTrackId: string;
    targetDeviceId: string;
};

type LiveAudibility = 'audible' | 'muted' | 'solo-suppressed';

type AgentMeasurementTarget = {
    targetId: string;
    targetKind: 'master' | 'track' | 'bus';
    liveAudibility: LiveAudibility;
    /** The isolated render of a track or bus target; null for the master mixdown. */
    subgraph: OfflineRenderSubgraph | null;
};

type AgentMeasurementTargetRefusal = {
    status: 'refused';
    code: 'unknown-target' | 'kind-mismatch' | 'muted-contributor';
    targetId: string;
    /** The muted subgraph member a `muted-contributor` refusal names. */
    contributorId: string | null;
};

type ResolveAgentMeasurementTargetsResult =
    { status: 'resolved'; soloActive: boolean; targets: AgentMeasurementTarget[] } | AgentMeasurementTargetRefusal;

/** The live solo read model, derived exactly as the live solo path derives it. */
function readLiveAudibility(tracks: Track[]): EffectiveAudibility {
    const stripTrackIds = new Set(
        tracks
            .filter(
                (track) =>
                    shouldCreateLiveTrackStrip(track) &&
                    tracks.filter((candidate) => candidate.id === track.id).length === 1
            )
            .map((track) => track.id)
    );
    return deriveEffectiveAudibility({
        tracks,
        soloMode: workspaceStore.value?.soloMode ?? 'sip',
        stripTrackIds,
    });
}

function liveAudibilityOf(track: Track | undefined, audibility: EffectiveAudibility): LiveAudibility {
    if (track?.muted) {
        return 'muted';
    }
    if (track !== undefined && audibility.audibleByTrackId.get(track.id) === false) {
        return 'solo-suppressed';
    }
    return 'audible';
}

function matchesScopeKind(track: Track, kind: 'tracks' | 'buses'): boolean {
    const eligibility = getTrackEligibility(track.kind);
    if (kind === 'tracks') {
        return eligibility.rendersTrackContent;
    }
    return track.kind !== 'master' && eligibility.acceptsRoutingEndpoint && !eligibility.rendersTrackContent;
}

/**
 * Sources of the sidechain routes `collectWiredSidechainDetectorRoutes` in
 * AudioEngine wires for these strips: both ends are rendered and the named
 * device is an unbypassed sidechain compressor. `renderTrackSubgraphOffline`
 * honours the mute of exactly these strips and force-unmutes every other one.
 */
function collectSidechainKeySourceIds(
    renderTracks: readonly Track[],
    routes: readonly SidechainDetectorRoute[]
): Set<string> {
    const trackById = new Map(renderTracks.map((track) => [track.id, track]));
    const keySourceIds = new Set<string>();
    for (const route of routes) {
        if (!trackById.has(route.sourceTrackId)) {
            continue;
        }
        const targetDevice = trackById
            .get(route.targetTrackId)
            ?.devices.find((device) => device.id === route.targetDeviceId && !device.bypassed);
        if (targetDevice?.type === 'builtin-sidechain-compressor') {
            keySourceIds.add(route.sourceTrackId);
        }
    }
    return keySourceIds;
}

function resolveIsolatedTarget(
    targetId: string,
    kind: 'tracks' | 'buses',
    tracks: Track[],
    audibility: EffectiveAudibility
): { status: 'target'; target: AgentMeasurementTarget } | AgentMeasurementTargetRefusal {
    const target = tracks.find((track) => track.id === targetId);
    if (target === undefined) {
        return { status: 'refused', code: 'unknown-target', targetId, contributorId: null };
    }
    if (!matchesScopeKind(target, kind)) {
        return { status: 'refused', code: 'kind-mismatch', targetId, contributorId: null };
    }
    const sidechainRoutes = sidechainStore.value?.routes ?? [];
    const subgraph = selectOfflineRenderSubgraph({
        targetTrack: target,
        allTracks: tracks,
        sidechainRoutes,
        includeSendReturns: true,
    });
    const keySourceIds = collectSidechainKeySourceIds(subgraph.renderTracks, sidechainRoutes);
    const mutedContributor = subgraph.renderTracks.find(
        (track) => track.id !== targetId && track.muted && !keySourceIds.has(track.id)
    );
    if (mutedContributor !== undefined) {
        return { status: 'refused', code: 'muted-contributor', targetId, contributorId: mutedContributor.id };
    }
    return {
        status: 'target',
        target: {
            targetId,
            targetKind: kind === 'tracks' ? 'track' : 'bus',
            liveAudibility: liveAudibilityOf(target, audibility),
            subgraph,
        },
    };
}

/**
 * The render targets of one agent measurement scope, each with how it sounds live.
 *
 * A track or bus target renders its isolated subgraph, which carries every
 * member's content regardless of that member's own mute. A muted member other
 * than the target and the sidechain keys would therefore print audio the live
 * mix does not carry, so the scope is refused instead of rendered.
 */
export function resolveAgentMeasurementTargets(
    input: ResolveAgentMeasurementTargetsInput
): ResolveAgentMeasurementTargetsResult {
    const tracks = trackStore.value?.tracks ?? [];
    const audibility = readLiveAudibility(tracks);
    if (input.kind === 'master') {
        const masterTrack = tracks.find((track) => track.kind === 'master');
        return {
            status: 'resolved',
            soloActive: audibility.anySoloed,
            targets: [
                {
                    targetId: 'master',
                    targetKind: 'master',
                    liveAudibility: liveAudibilityOf(masterTrack, audibility),
                    subgraph: null,
                },
            ],
        };
    }
    const targets: AgentMeasurementTarget[] = [];
    for (const targetId of input.ids) {
        const resolved = resolveIsolatedTarget(targetId, input.kind, tracks, audibility);
        if (resolved.status === 'refused') {
            return resolved;
        }
        targets.push(resolved.target);
    }
    return { status: 'resolved', soloActive: audibility.anySoloed, targets };
}
