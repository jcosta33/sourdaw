import { type AdjustmentEffectType } from '#/modules/Arrangement/stores';

import { AdjustmentBusNode } from './AdjustmentBusNode';

type RegionKey = string;

type LiveBus = {
    layerId: string;
    trackId: string;
    effectType: AdjustmentEffectType;
    bus: AdjustmentBusNode;
    lastParamSignature: string;
    lastBlend: number;
    disposalTimer: ReturnType<typeof setTimeout> | null;
    /**
     * The layer's position in the stack that governs this track's chain, as
     * the latest tick carrying it reported. Records within a tick arrive in
     * the project's layer stack order (the applier walks the stack array), so
     * the chain order is a function of the stack, never of the order the buses
     * happened to be created in (#4603).
     */
    stackRank: number;
    /** Tie-break for buses whose layers never co-occur in one tick. */
    creationSeq: number;
};

export type TrackRerouteDeps = {
    rerouteTrack: (trackId: string) => void;
    getTrackDefaultDestination: (trackId: string) => AudioNode | null;
    getContext: () => BaseAudioContext | null;
};

type ApplyInput = {
    trackId: string;
    layerId: string;
    effectType: AdjustmentEffectType;
    parameters: Record<string, number>;
    blend: number;
};

export type AdjustmentLayerRuntimeDiagnostics = {
    buses: number;
    busesByEffectType: Record<string, number>;
    audioNodes: number;
    audioWorkletProcessors: number;
};

export type AdjustmentLayerRuntime = {
    applyTick: (records: ApplyInput[]) => void;
    getBusInputForTrack: (trackId: string) => AudioNode | null;
    getBusChainInputForTrack: (trackId: string) => AudioNode | null;
    reset: () => void;
    listLiveBusKeys: () => string[];
    getDiagnostics: () => AdjustmentLayerRuntimeDiagnostics;
};

const FADE_OUT_GRACE_MS = 300;

function keyFor(layerId: string, trackId: string): RegionKey {
    return `${layerId}::${trackId}`;
}

function paramSignature(params: Record<string, number>): string {
    const sortedKeys = Object.keys(params).sort();
    const parts: string[] = [];
    for (const k of sortedKeys) {
        parts.push(`${k}=${params[k]}`);
    }
    return parts.join('|');
}

export function createAdjustmentLayerRuntime(deps: TrackRerouteDeps): AdjustmentLayerRuntime {
    const liveBuses = new Map<RegionKey, LiveBus>();
    let creationSeqCounter = 0;

    const chainedBusesForTrack = (trackId: string): AdjustmentBusNode[] => {
        const live: LiveBus[] = [];
        for (const candidate of liveBuses.values()) {
            if (candidate.trackId === trackId) {
                live.push(candidate);
            }
        }
        live.sort((left, right) => left.stackRank - right.stackRank || left.creationSeq - right.creationSeq);
        return live.map((entry) => entry.bus);
    };

    const getBusChainInputForTrack = (trackId: string): AudioNode | null => {
        const chain = chainedBusesForTrack(trackId);
        return chain.length > 0 ? chain[0]!.inputNode : null;
    };

    const wireChain = (trackId: string): void => {
        const chain = chainedBusesForTrack(trackId);
        const finalDest = deps.getTrackDefaultDestination(trackId);
        for (let i = 0; i < chain.length; i++) {
            const current = chain[i]!;
            const next = chain[i + 1];
            if (next) {
                current.connectDestination(next.inputNode);
            } else if (finalDest) {
                current.connectDestination(finalDest);
            } else {
                current.disconnectDestination();
            }
        }
    };

    const createBus = (input: ApplyInput, stackRank: number): LiveBus | null => {
        const ctx = deps.getContext();
        if (!ctx) {
            return null;
        }
        const bus = new AdjustmentBusNode({
            context: ctx,
            effectType: input.effectType,
            parameters: input.parameters,
        });
        bus.setBlend(input.blend);
        return {
            layerId: input.layerId,
            trackId: input.trackId,
            effectType: input.effectType,
            bus,
            lastParamSignature: paramSignature(input.parameters),
            lastBlend: input.blend,
            disposalTimer: null,
            stackRank,
            creationSeq: creationSeqCounter++,
        };
    };

    const finalizeDisposal = (key: RegionKey): void => {
        const live = liveBuses.get(key);
        if (!live) {
            return;
        }
        live.bus.dispose();
        liveBuses.delete(key);
        deps.rerouteTrack(live.trackId);
        wireChain(live.trackId);
    };

    return {
        applyTick: (records): void => {
            const seen = new Set<RegionKey>();
            const touchedTracks = new Set<string>();
            // Tracks whose chain order the tick's record sequence revised — a
            // stack reorder moves existing buses without creating any.
            const reorderedTracks = new Set<string>();
            // The layer's position among this tick's active layers for its
            // track, in first-seen order — the stack order the applier walks.
            const tickRanks = new Map<RegionKey, number>();

            for (const rec of records) {
                if (rec.effectType === 'volume' || rec.effectType === 'pan') {
                    continue;
                }
                const key = keyFor(rec.layerId, rec.trackId);
                seen.add(key);
                let rank = tickRanks.get(key);
                if (rank === undefined) {
                    rank = tickRanks.size;
                    tickRanks.set(key, rank);
                }
                const existing = liveBuses.get(key);
                if (existing) {
                    if (existing.disposalTimer) {
                        clearTimeout(existing.disposalTimer);
                        existing.disposalTimer = null;
                    }
                    const sig = paramSignature(rec.parameters);
                    if (sig !== existing.lastParamSignature) {
                        existing.bus.setParams(rec.parameters);
                        existing.lastParamSignature = sig;
                    }
                    if (rec.blend !== existing.lastBlend) {
                        existing.bus.setBlend(rec.blend);
                        existing.lastBlend = rec.blend;
                    }
                    if (existing.stackRank !== rank) {
                        existing.stackRank = rank;
                        reorderedTracks.add(rec.trackId);
                    }
                    continue;
                }
                const live = createBus(rec, rank);
                if (live) {
                    liveBuses.set(key, live);
                    touchedTracks.add(rec.trackId);
                }
            }

            for (const [key, live] of Array.from(liveBuses.entries())) {
                if (seen.has(key)) {
                    continue;
                }
                if (live.disposalTimer) {
                    continue;
                }
                live.bus.setBlend(0);
                live.lastBlend = 0;
                live.disposalTimer = setTimeout(() => {
                    live.disposalTimer = null;
                    finalizeDisposal(key);
                }, FADE_OUT_GRACE_MS);
            }

            for (const trackId of touchedTracks) {
                wireChain(trackId);
                deps.rerouteTrack(trackId);
            }
            for (const trackId of reorderedTracks) {
                if (touchedTracks.has(trackId)) {
                    continue;
                }
                wireChain(trackId);
                deps.rerouteTrack(trackId);
            }
        },
        getBusInputForTrack: getBusChainInputForTrack,
        getBusChainInputForTrack,
        reset: (): void => {
            const trackIds = new Set<string>();
            for (const live of liveBuses.values()) {
                trackIds.add(live.trackId);
                if (live.disposalTimer) {
                    clearTimeout(live.disposalTimer);
                    live.disposalTimer = null;
                }
                live.bus.dispose();
            }
            liveBuses.clear();
            for (const trackId of trackIds) {
                deps.rerouteTrack(trackId);
            }
        },
        listLiveBusKeys: (): string[] => {
            return Array.from(liveBuses.keys()).sort();
        },
        getDiagnostics: (): AdjustmentLayerRuntimeDiagnostics => {
            const busesByEffectType = new Map<string, number>();
            let audioNodes = 0;
            let audioWorkletProcessors = 0;
            for (const live of liveBuses.values()) {
                const resources = live.bus.getRuntimeResources();
                audioNodes += resources.audioNodes;
                audioWorkletProcessors += resources.audioWorkletProcessors;
                busesByEffectType.set(resources.effectType, (busesByEffectType.get(resources.effectType) ?? 0) + 1);
            }
            return {
                buses: liveBuses.size,
                busesByEffectType: Object.fromEntries(
                    [...busesByEffectType].sort(([left], [right]) => left.localeCompare(right))
                ),
                audioNodes,
                audioWorkletProcessors,
            };
        },
    };
}
