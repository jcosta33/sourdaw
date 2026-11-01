/**
 * Routing-graph cycle detection (FX-2).
 *
 * A Web Audio graph that contains a cycle with no `DelayNode` in it is muted
 * outright by the spec's rendering algorithm, so a mis-routed send does not
 * "howl" — it silently kills every node in the loop. The routing mutation
 * boundary therefore has to reject the edge before it is written, rather than
 * relying on the UI to grey a control out.
 *
 * Lives in `src/utils/` (module-agnostic, zero imports) because both the
 * Arrangement mutators (`setSend`, `setTrackOutput`) and the Routing sidechain
 * mutator (`addSidechainRoute`) must enforce the *same* relation. Routing may
 * not reach into `Arrangement/services/`, and duplicating the traversal is how
 * the sidechain guard ended up seeing only a third of the graph.
 *
 * The edge relation matches the one the render/latency traversals already use
 * (`getUpstreamSubgraph`, `getTrackLatency`): a track feeds its `outputId`, it
 * feeds every `sends[].busId`, and a sidechain route feeds its `targetTrackId`.
 * All three are real audio edges, so all three can close a loop.
 */

/**
 * Structural view of a track — only the fields that carry a routing edge.
 *
 * `outputId` and `sends` are optional here even though `Track` declares them
 * required: this detector also runs over CRDT-ingested and partially-hydrated
 * rows, which reach `normalizeTrack`'s defaults only later. A missing edge
 * field means "no edge", never a crash inside a mutation guard.
 */
export type RoutingCycleTrack = {
    id: string;
    outputId?: string | undefined;
    sends?: readonly { busId: string }[] | undefined;
};

/** Structural view of a sidechain route (source keys the target's detector). */
export type RoutingCycleSidechainRoute = {
    sourceTrackId: string;
    targetTrackId: string;
};

export type WouldCreateRoutingCycleInput = {
    /** The node the proposed edge leaves. */
    sourceId: string;
    /** The node the proposed edge enters. */
    targetId: string;
    /** Every track in the project, carrying the edges that already exist. */
    tracks: readonly RoutingCycleTrack[];
    /** Sidechain routes that already exist. Omit when there are none. */
    sidechainRoutes?: readonly RoutingCycleSidechainRoute[];
};

/**
 * Indexes all three edge relations once, retaining every duplicate-owner row.
 */
function indexDownstreamSuccessors(
    tracks: readonly RoutingCycleTrack[],
    sidechainRoutes: readonly RoutingCycleSidechainRoute[]
): Map<string, string[]> {
    const downstream = new Map<string, string[]>();
    for (const track of tracks) {
        const successors = downstream.get(track.id) ?? [];
        if (track.outputId) {
            successors.push(track.outputId);
        }
        for (const send of track.sends ?? []) {
            successors.push(send.busId);
        }
        downstream.set(track.id, successors);
    }
    for (const route of sidechainRoutes) {
        const successors = downstream.get(route.sourceTrackId) ?? [];
        successors.push(route.targetTrackId);
        downstream.set(route.sourceTrackId, successors);
    }
    return downstream;
}

/**
 * True when adding the edge `sourceId → targetId` would close a routing cycle.
 *
 * Adding an edge creates a cycle exactly when it is a self-edge, or when
 * `targetId` can already reach `sourceId` by following existing edges
 * downstream — the new edge would then complete the loop. This is a plain
 * reachability query, so a single `visited` set is both correct and enough to
 * terminate on a graph that is *already* cyclic (which stored projects may be,
 * since nothing guarded these writes before).
 *
 * Terminal endpoints that are not tracks (`master` when no master track
 * exists, `hw_out`) simply have no successors and end the walk.
 */
export function wouldCreateRoutingCycle({
    sourceId,
    targetId,
    tracks,
    sidechainRoutes = [],
}: WouldCreateRoutingCycleInput): boolean {
    if (sourceId === targetId) {
        return true;
    }

    const downstream = indexDownstreamSuccessors(tracks, sidechainRoutes);
    const visited = new Set<string>();
    const toProcess = [targetId];

    while (toProcess.length > 0) {
        const currentId = toProcess.pop()!;
        if (currentId === sourceId) {
            return true;
        }
        if (visited.has(currentId)) {
            continue;
        }
        visited.add(currentId);
        for (const successor of downstream.get(currentId) ?? []) {
            toProcess.push(successor);
        }
    }

    return false;
}

export function hasRoutingCycle({
    tracks,
    sidechainRoutes = [],
}: Pick<WouldCreateRoutingCycleInput, 'tracks' | 'sidechainRoutes'>): boolean {
    const downstream = indexDownstreamSuccessors(tracks, sidechainRoutes);
    const visited = new Set<string>();
    const active = new Set<string>();

    function visit(nodeId: string): boolean {
        if (active.has(nodeId)) {
            return true;
        }
        if (visited.has(nodeId)) {
            return false;
        }
        visited.add(nodeId);
        active.add(nodeId);
        for (const successor of downstream.get(nodeId) ?? []) {
            if (visit(successor)) {
                return true;
            }
        }
        active.delete(nodeId);
        return false;
    }

    for (const nodeId of downstream.keys()) {
        if (visit(nodeId)) {
            return true;
        }
    }
    return false;
}
