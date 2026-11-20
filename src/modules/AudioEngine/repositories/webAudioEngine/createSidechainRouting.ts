import type { TrackChannelStrip } from '../../models/AudioEngineState';

/**
 * Ceiling (seconds) on a sidechain key alignment line. PDC values are single-
 * digit milliseconds to low tens; a `DelayNode` allocates its ring buffer from
 * this maximum, so it is generous enough that no realistic chain is clipped and
 * small enough that the buffer stays trivial.
 */
const SIDECHAIN_KEY_MAX_DELAY_SECONDS = 1;

/** Glide span (seconds) for a key-alignment change — one scheduler grain, the
 *  same span the automation ramps use. Stepping `delayTime` resamples the key
 *  and clicks; a short a-rate ramp does not. */
const SIDECHAIN_KEY_DELAY_RAMP_SECONDS = 0.01;

/** Below this (seconds, well under a sample at any rate) a re-resolved key
 *  alignment counts as unchanged and schedules nothing — the alignment refresh
 *  runs every scheduler tick and must not churn AudioParam events. */
const SIDECHAIN_KEY_DELAY_EPSILON_SECONDS = 1e-6;

export type SidechainRoute = { sourceTrackId: string; targetTrackId: string; targetDeviceId: string };

/** Resolves the seconds of key delay a wired sidechain route currently needs.
 *  Supplied by the use-case layer (`refreshSidechainAlignment`) so the engine
 *  never reaches into project state for it. */
export type SidechainKeyDelayResolver = (route: SidechainRoute) => number;

type SidechainConnection = SidechainRoute & {
    sourceNode: AudioNode;
    /** FX-5 — key alignment line sitting between the tap and the route gain. */
    keyDelayNode: DelayNode;
    /** Last value written to {@link keyDelayNode}, so a per-tick refresh that
     *  resolves the same alignment schedules nothing at all. */
    appliedKeyDelaySec: number;
    gainNode: GainNode;
};

export type SidechainRouting = {
    /**
     * Sidechain routes requested while the engine could not wire them (fallback
     * mode — no live AudioContext). Keyed by `${sourceTrackId}→${targetDeviceId}`
     * so an unwire request can cancel a still-pending wire. These are replayed
     * the next time wireRoute runs outside fallback mode, so a route requested
     * before the engine was usable is not silently lost (the store keeps the
     * route but the live graph would otherwise diverge with no recovery).
     */
    readonly pendingRoutes: Map<string, SidechainRoute>;
    connectionCount(): number;
    wireRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void;
    unwireRoute(sourceTrackId: string, targetDeviceId: string): void;
    refreshAlignment(keyDelayFor: SidechainKeyDelayResolver): void;
    /** Re-attaches every key the track feeds to the post-fader tap of its rebuilt strip. */
    reconnectTrack(trackId: string, strip: TrackChannelStrip): void;
    /** Drops every queued route with the track, or one of its removed devices, at either end. */
    forgetPendingRoutesOf(trackId: string, removedDeviceIds: ReadonlySet<string>): void;
    /** Removes every live route the track feeds or one of its removed devices receives. */
    removeConnectionsOf(trackId: string, removedDeviceIds: ReadonlySet<string>): void;
    /** The graph reset's disconnect effects for every route live when called. */
    resetEffects(): Array<() => void>;
    /** Forgets every live and queued route. */
    clear(): void;
};

export type SidechainRoutingPorts = Readonly<{
    readContext: () => AudioContext;
    isFallback: () => boolean;
    /** The live strip of a track, read per call. */
    readTrackStrip: (trackId: string) => TrackChannelStrip | undefined;
    /** Publishes one runtime-graph generation when the mutation reports a material change. */
    mutateRuntimeGraph: (mutation: () => boolean) => void;
}>;

function routeKey(sourceTrackId: string, targetDeviceId: string): string {
    return `${sourceTrackId}→${targetDeviceId}`;
}

function glideKeyDelay(connection: SidechainConnection, resolved: number, now: number): void {
    const nextSeconds = Math.min(Math.max(resolved, 0), SIDECHAIN_KEY_MAX_DELAY_SECONDS);
    if (Math.abs(nextSeconds - connection.appliedKeyDelaySec) < SIDECHAIN_KEY_DELAY_EPSILON_SECONDS) {
        return;
    }
    // Same anchor-then-ramp idiom the automation writes use: a stepped
    // delayTime resamples the key and clicks, so re-anchor at the live
    // value, drop stale future events, and glide over one grain.
    const param = connection.keyDelayNode.delayTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(nextSeconds, now + SIDECHAIN_KEY_DELAY_RAMP_SECONDS);
    connection.appliedKeyDelaySec = nextSeconds;
}

function disconnectConnection(connection: SidechainConnection): void {
    try {
        connection.sourceNode.disconnect(connection.keyDelayNode);
    } catch {
        // The source edge was already detached by a wider graph teardown.
    }
    try {
        connection.keyDelayNode.disconnect();
    } catch {
        // The alignment line was already detached by a wider graph teardown.
    }
    try {
        connection.gainNode.disconnect();
    } catch {
        // The target edge was already detached by a wider graph teardown.
    }
}

type ConnectionMap = Map<string, SidechainConnection>;
type SidechainState = Readonly<{
    connections: ConnectionMap;
    pendingRoutes: Map<string, SidechainRoute>;
    readContext: () => AudioContext;
    readTrackStrip: SidechainRoutingPorts['readTrackStrip'];
    isFallback: () => boolean;
}>;

function applyRoute(
    state: SidechainState,
    sourceTrackId: string,
    targetTrackId: string,
    targetDeviceId: string
): boolean {
    const { connections, readContext, readTrackStrip } = state;
    const sourceStrip = readTrackStrip(sourceTrackId);
    const targetStrip = readTrackStrip(targetTrackId);
    if (!sourceStrip || !targetStrip) {
        return false;
    }

    const deviceNode = targetStrip.deviceNodes.find((data) => data.deviceId === targetDeviceId);
    if (!deviceNode || deviceNode.type !== 'builtin-sidechain-compressor') {
        return false;
    }

    const key = routeKey(sourceTrackId, targetDeviceId);
    if (connections.has(key)) {
        return false;
    }

    const context = readContext();
    const scGain = context.createGain();
    scGain.gain.value = 1;
    // FX-5 — the key is tapped post-fader, so it reaches the detector on the
    // source track's clock, not the detector's. The alignment line goes
    // between the tap and the route gain: after the metering/sends tap (which
    // must keep reading the un-delayed signal) and before the detector input.
    // It starts at zero and is filled in by refreshAlignment, which owns
    // every write to it so there is exactly one place the value lands.
    const keyDelayNode = context.createDelay(SIDECHAIN_KEY_MAX_DELAY_SECONDS);
    keyDelayNode.delayTime.value = 0;
    const sourceNode = sourceStrip.analyserNode;
    sourceNode.connect(keyDelayNode);
    keyDelayNode.connect(scGain);
    scGain.connect(deviceNode.inputNode, 0, 1);
    connections.set(key, {
        sourceTrackId,
        targetTrackId,
        targetDeviceId,
        sourceNode,
        keyDelayNode,
        appliedKeyDelaySec: 0,
        gainNode: scGain,
    });
    return true;
}

/**
 * Re-attempt every sidechain route queued during fallback mode. Routes that
 * still cannot be wired (e.g. the target strip/device is not present yet) are
 * dropped from the queue by applyRoute's own guards — they are no longer
 * recoverable through this path and the caller owns re-requesting.
 */
function replayPendingRoutes(state: SidechainState): boolean {
    const { pendingRoutes } = state;
    if (pendingRoutes.size === 0) {
        return false;
    }
    const queued = Array.from(pendingRoutes.values());
    pendingRoutes.clear();
    let changed = false;
    for (const route of queued) {
        changed = applyRoute(state, route.sourceTrackId, route.targetTrackId, route.targetDeviceId) || changed;
    }
    return changed;
}

function removeConnection(connections: ConnectionMap, key: string): boolean {
    const connection = connections.get(key);
    if (!connection) {
        return false;
    }
    disconnectConnection(connection);
    connections.delete(key);
    return true;
}

/**
 * FX-5 — re-resolve every wired route's key alignment and glide the delay
 * lines onto it. Called on wire and once per scheduler tick, so a mid-session
 * latency push (a native plugin reporting a new lookahead, a device added or
 * bypassed) lands within one grain instead of holding a stale alignment for
 * the rest of the session. Nothing is cached across calls beyond the value
 * last written, which exists purely to keep an unchanged alignment from
 * scheduling AudioParam events every tick.
 */
function refreshAlignment(state: SidechainState, keyDelayFor: SidechainKeyDelayResolver): void {
    const { connections, readContext, isFallback } = state;
    if (isFallback() || connections.size === 0) {
        return;
    }
    const now = readContext().currentTime;
    for (const connection of connections.values()) {
        const resolved = keyDelayFor({
            sourceTrackId: connection.sourceTrackId,
            targetTrackId: connection.targetTrackId,
            targetDeviceId: connection.targetDeviceId,
        });
        glideKeyDelay(connection, resolved, now);
    }
}

function reconnectConnectionsOfTrack(connections: ConnectionMap, trackId: string, strip: TrackChannelStrip): void {
    for (const connection of connections.values()) {
        if (connection.sourceTrackId !== trackId) {
            continue;
        }
        // The tap stays post-fader (`analyserNode`); the key alignment line
        // sits between it and the route gain, so a rebuild re-attaches the
        // tap to the delay rather than straight to the gain.
        const sourceNode = strip.analyserNode;
        try {
            connection.sourceNode.disconnect(connection.keyDelayNode);
        } catch {
            // A wider rebuild may already have removed the prior source edge.
        }
        sourceNode.connect(connection.keyDelayNode);
        connection.sourceNode = sourceNode;
    }
}

function forgetPendingRoutesOf(
    pendingRoutes: Map<string, SidechainRoute>,
    trackId: string,
    removedDeviceIds: ReadonlySet<string>
): void {
    for (const [key, route] of pendingRoutes) {
        const belongsToRemovedStrip =
            route.sourceTrackId === trackId ||
            route.targetTrackId === trackId ||
            removedDeviceIds.has(route.targetDeviceId);
        if (belongsToRemovedStrip) {
            pendingRoutes.delete(key);
        }
    }
}

function removeConnectionsOf(connections: ConnectionMap, trackId: string, removedDeviceIds: ReadonlySet<string>): void {
    for (const [key, connection] of connections) {
        if (connection.sourceTrackId === trackId || removedDeviceIds.has(connection.targetDeviceId)) {
            removeConnection(connections, key);
        }
    }
}

function resetEffects(connections: ConnectionMap): Array<() => void> {
    return Array.from(connections.values()).flatMap((connection) => [
        () => {
            try {
                connection.sourceNode.disconnect(connection.keyDelayNode);
            } catch {
                // The source edge may already be detached by wider teardown.
            }
        },
        () => connection.keyDelayNode.disconnect(),
        () => connection.gainNode.disconnect(),
    ]);
}

export function createSidechainRouting({
    readContext,
    isFallback,
    readTrackStrip,
    mutateRuntimeGraph,
}: SidechainRoutingPorts): SidechainRouting {
    const connections: ConnectionMap = new Map();
    const pendingRoutes = new Map<string, SidechainRoute>();
    const state: SidechainState = { connections, pendingRoutes, readContext, readTrackStrip, isFallback };

    function wireRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void {
        const key = routeKey(sourceTrackId, targetDeviceId);
        if (isFallback()) {
            // No live AudioContext to wire into. Queue the route instead of
            // dropping it, so the next time wiring runs outside fallback mode the
            // route is replayed rather than lost (the store keeps the route, so
            // silently no-op'ing here would diverge the live graph with no
            // recovery path).
            pendingRoutes.set(key, { sourceTrackId, targetTrackId, targetDeviceId });
            return;
        }
        // Recovery: drain any routes queued while the engine was in fallback mode
        // before honoring this request, so a route requested before the engine
        // was usable is now wired up.
        mutateRuntimeGraph(() => {
            const replayed = replayPendingRoutes(state);
            const applied = applyRoute(state, sourceTrackId, targetTrackId, targetDeviceId);
            return replayed || applied;
        });
    }

    function unwireRoute(sourceTrackId: string, targetDeviceId: string): void {
        const key = routeKey(sourceTrackId, targetDeviceId);
        // Cancel a still-pending (queued-in-fallback) wire so an unwire issued
        // before recovery does not get replayed back into the live graph.
        pendingRoutes.delete(key);
        mutateRuntimeGraph(() => removeConnection(connections, key));
    }

    return {
        pendingRoutes,
        connectionCount: () => connections.size,
        wireRoute,
        unwireRoute,
        refreshAlignment: (keyDelayFor) => {
            refreshAlignment(state, keyDelayFor);
        },
        reconnectTrack: (trackId, strip) => {
            reconnectConnectionsOfTrack(connections, trackId, strip);
        },
        forgetPendingRoutesOf: (trackId, removedDeviceIds) => {
            forgetPendingRoutesOf(pendingRoutes, trackId, removedDeviceIds);
        },
        removeConnectionsOf: (trackId, removedDeviceIds) => {
            removeConnectionsOf(connections, trackId, removedDeviceIds);
        },
        resetEffects: () => resetEffects(connections),
        clear: () => {
            connections.clear();
            pendingRoutes.clear();
        },
    };
}
