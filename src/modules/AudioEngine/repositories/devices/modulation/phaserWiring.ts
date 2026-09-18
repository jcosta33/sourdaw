import { type OfflineDeviceNode } from '../types';

// ── Phaser chain wiring ──────────────────────────────────────────────────
//
// Stages selects how many allpass filters sit in the chain — the chain is
// rewired to that count. It never maps onto Q: a Q step would leave 2, 6 and
// 12 stages sounding identical while advertising a stage count.

/** Declared `phaser-stages` window (descriptor: int 2..12). */
export const PHASER_STAGES_RANGE = { min: 2, max: 12 } as const;

const MAX_FILTER_POOL = PHASER_STAGES_RANGE.max;

/** Resolve the chain nodes by semantic name, falling back to slot layout. */
function resolvePhaserNodes(dn: OfflineDeviceNode): {
    filters: BiquadFilterNode[];
    splitter: AudioNode;
    wet: AudioNode;
    feedback: GainNode;
} {
    const nn = dn.namedNodes;
    const filters: BiquadFilterNode[] = [];
    for (let index = 0; index < MAX_FILTER_POOL; index++) {
        const filter = nn?.[`filter${index}`] ?? dn.nodes[3 + index];
        if (filter) {
            filters.push(filter as BiquadFilterNode);
        }
    }
    return {
        filters,
        splitter: (nn?.splitter ?? dn.nodes[0]) as AudioNode,
        wet: (nn?.wet ?? dn.nodes[2]) as AudioNode,
        feedback: (nn?.feedback ?? dn.nodes[17]) as GainNode,
    };
}

/**
 * Wire exactly `stages` allpass filters (clamped to the declared 2..12)
 * between the splitter and the wet gain, closing the feedback loop around the
 * chain. Every pooled filter is dropped from the wet path first — a shrinking
 * count must not leave trailing stages still feeding it — then the active
 * chain is rebuilt. Idempotent connections (splitter→first, feedback→first)
 * coalesce per spec.
 */
export function wirePhaserStages(dn: OfflineDeviceNode, stages: number): void {
    const { filters, splitter, wet, feedback } = resolvePhaserNodes(dn);
    if (filters.length === 0) {
        return;
    }
    const active = Math.min(
        PHASER_STAGES_RANGE.max,
        Math.max(PHASER_STAGES_RANGE.min, Math.round(stages)),
        filters.length
    );
    for (const filter of filters) {
        filter.disconnect();
    }
    splitter.connect(filters[0]!);
    for (let index = 0; index < active - 1; index++) {
        filters[index]!.connect(filters[index + 1]!);
    }
    const lastFilter = filters[active - 1]!;
    lastFilter.connect(feedback);
    feedback.connect(filters[0]!);
    lastFilter.connect(wet);
}
