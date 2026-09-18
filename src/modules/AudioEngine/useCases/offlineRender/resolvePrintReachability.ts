import { type Track } from '#/modules/Arrangement/stores';

import { type WiredSidechainDetectorRoute } from './collectWiredSidechainDetectorRoutes';

/**
 * Where a strip's own post-fader output goes in the render being computed.
 *
 * `outside-render` is deliberately a third answer rather than a synonym for
 * either neighbour. A route that leaves the strips this render builds cannot be
 * proved silent, and the two errors are not symmetric: a false "contributes"
 * refuses a render the user could have had, while a false "does not contribute"
 * silently bakes a file missing a device whose output printed — the exact loss
 * this refusal exists to prevent. An unprovable route is therefore read as
 * printing.
 */
export type PrintOutputRoute =
    Readonly<{ kind: 'prints' }> | Readonly<{ kind: 'strip'; trackId: string }> | Readonly<{ kind: 'outside-render' }>;

export type ResolvePrintReachabilityInput = Readonly<{
    /** Every strip this render builds. */
    tracks: readonly Track[];
    /**
     * Whether this render honours a strip's own mute. Freeze and bounce honour
     * only a sidechain key source's, because a deliverable print force-unmutes
     * everything else; the mixdown honours every strip's.
     */
    honorMuted: (trackId: string) => boolean;
    /**
     * Whether this render wires a strip's sends at all. Freeze and bounce drop
     * the target's sends when the caller asks; every other strip keeps its own.
     */
    sendsRendered: (trackId: string) => boolean;
    /** Where a strip's post-fader output goes in this render. */
    resolveOutputRoute: (track: Track) => PrintOutputRoute;
    /** The detector routes this render wires; see `collectWiredSidechainDetectorRoutes`. */
    detectorRoutes: readonly WiredSidechainDetectorRoute[];
    /**
     * Whether a solo-in-place gate closes a strip's pre-fader tap. The gate sits
     * ahead of every tap, so such a strip is silent *and* forwards nothing
     * routed into it — that is what separates solo-in-place from mute. Freeze and
     * bounce apply no such gate; the mixdown does.
     */
    isSoloGated?: (trackId: string) => boolean;
}>;

/**
 * Which strips of one render can reach what that render prints (#4376).
 *
 * A strip contributes when at least one route from its device-chain output
 * reaches the print while surviving every cut the render honours:
 *
 *   - its own post-fader output, through unmuted hops, to a strip this render
 *     prints, or along a route that leaves the strips this render builds (which
 *     cannot be proved silent, and so is read as printing);
 *   - a pre-fader send it actually renders, into a strip that itself
 *     contributes. The pre-fader tap sits upstream of the mute node, so this is
 *     the route that survives the strip's own mute;
 *   - its output feeding a detector whose compressor's printed output it
 *     changes. Live taps a key after the mute, so that feed dies with the key's
 *     own honoured mute.
 *
 * Every other route is cut by a mute this render honours, and only then does the
 * strip stop contributing. The direction of the error is deliberate: see
 * `PrintOutputRoute`.
 *
 * Routing is read as a graph and answered at its least fixpoint, because a chain
 * of hops is only reachable once the strips downstream of it are — while a cycle
 * that never reaches the print stays unreachable.
 */
export function resolvePrintReachability({
    tracks,
    honorMuted,
    sendsRendered,
    resolveOutputRoute,
    detectorRoutes,
    isSoloGated,
}: ResolvePrintReachabilityInput): ReadonlySet<string> {
    const detectorTargetsBySourceId = new Map<string, Set<string>>();
    for (const route of detectorRoutes) {
        const targets = detectorTargetsBySourceId.get(route.sourceTrackId) ?? new Set<string>();
        targets.add(route.targetTrackId);
        detectorTargetsBySourceId.set(route.sourceTrackId, targets);
    }

    const tapClosed = new Set<string>();
    const silentOutput = new Set<string>();
    for (const track of tracks) {
        const soloGated = isSoloGated?.(track.id) ?? false;
        if (soloGated) {
            tapClosed.add(track.id);
        }
        if (soloGated || (honorMuted(track.id) && track.muted)) {
            silentOutput.add(track.id);
        }
    }

    const reachesPrint = new Set<string>();

    const outputReachesPrint = (track: Track): boolean => {
        if (silentOutput.has(track.id)) {
            return false;
        }
        const route = resolveOutputRoute(track);
        if (route.kind === 'strip') {
            return reachesPrint.has(route.trackId);
        }
        return true;
    };

    const aSendReachesPrint = (track: Track): boolean => {
        if (tapClosed.has(track.id) || !sendsRendered(track.id)) {
            return false;
        }
        for (const send of track.sends) {
            if (send.preFader && reachesPrint.has(send.busId)) {
                return true;
            }
        }
        return false;
    };

    const aDetectorReachesPrintedOutput = (track: Track): boolean => {
        if (silentOutput.has(track.id)) {
            return false;
        }
        const targets = detectorTargetsBySourceId.get(track.id);
        if (!targets) {
            return false;
        }
        for (const targetTrackId of targets) {
            if (reachesPrint.has(targetTrackId)) {
                return true;
            }
        }
        return false;
    };

    let grew = true;
    while (grew) {
        grew = false;
        for (const track of tracks) {
            if (reachesPrint.has(track.id)) {
                continue;
            }
            if (outputReachesPrint(track) || aSendReachesPrint(track) || aDetectorReachesPrintedOutput(track)) {
                reachesPrint.add(track.id);
                grew = true;
            }
        }
    }
    return reachesPrint;
}
