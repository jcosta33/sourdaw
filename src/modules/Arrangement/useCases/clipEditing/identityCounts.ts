import { isRecord } from '#/utils/structuralEquality';

import { collectClipSplitIdentityIds } from '../../services/collectClipSplitIdentityIds';

function gainEnvelopeIdentityMaterial(envelope: unknown): unknown {
    if (!isRecord(envelope) || !Array.isArray(envelope.points)) {
        return envelope;
    }
    const points: readonly unknown[] = envelope.points;
    const pointMaterial = points.map((point) => {
        if (!isRecord(point)) {
            return point;
        }
        return Object.fromEntries(Object.entries(point).filter(([key]) => key !== 'id'));
    });
    return { ...envelope, points: pointMaterial };
}

function warpStateIdentityMaterial(state: unknown): unknown {
    if (!isRecord(state) || !Array.isArray(state.markers)) {
        return state;
    }
    const markers: readonly unknown[] = state.markers;
    const markerMaterial = markers.map((marker) => {
        if (!isRecord(marker)) {
            return marker;
        }
        return Object.fromEntries(Object.entries(marker).filter(([key]) => key !== 'id'));
    });
    return { ...state, markers: markerMaterial };
}

export function identityCounts(
    document: Readonly<Record<string, unknown>>,
    ids: ReadonlySet<string>
): Map<string, number> {
    const counts = new Map<string, number>();
    if (ids.size === 0) {
        return counts;
    }
    const live = Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'arrangements'));
    const gain = document.gainEnvelopes;
    if (isRecord(gain) && isRecord(gain.envelopes)) {
        const envelopeMaterial: [string, unknown][] = Object.entries(gain.envelopes).map(
            ([id, envelope]): [string, unknown] => [id, gainEnvelopeIdentityMaterial(envelope)]
        );
        const envelopes: Record<string, unknown> = Object.fromEntries(envelopeMaterial);
        live.gainEnvelopes = { ...gain, envelopes };
    }
    const warp = document.warpStates;
    if (isRecord(warp) && isRecord(warp.states)) {
        const states = Object.fromEntries(
            Object.entries(warp.states).map(([id, state]) => [id, warpStateIdentityMaterial(state)])
        );
        live.warpStates = { ...warp, states };
    }
    // Match readClipSplitIdentityIds: arrangements are a separate namespace,
    // and canonical gain-point and warp-marker IDs are local to their clip.
    // Mutable document proxies need not preserve identity across reads, so
    // omit just those IDs rather than relying on a WeakSet of objects.
    for (const id of ids) {
        counts.set(id, 0);
    }
    for (const id of collectClipSplitIdentityIds(live)) {
        if (ids.has(id)) {
            counts.set(id, (counts.get(id) ?? 0) + 1);
        }
    }
    return counts;
}
