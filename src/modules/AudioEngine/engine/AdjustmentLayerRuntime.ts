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
};

export type TrackRerouteDeps = {
    rerouteTrack: (trackId: string) => void;
    getTrackOutputNode: (trackId: string) => AudioNode | null;
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
    const busOrderByTrack = new Map<string, string[]>();

    const chainedBusesForTrack = (trackId: string): AdjustmentBusNode[] => {
        const order = busOrderByTrack.get(trackId) ?? [];
        const chain: AdjustmentBusNode[] = [];
        for (const layerId of order) {
            const live = liveBuses.get(keyFor(layerId, trackId));
            if (live) {
                chain.push(live.bus);
            }
        }
        return chain;
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

    const addLayerToOrder = (trackId: string, layerId: string): void => {
        const order = busOrderByTrack.get(trackId);
        if (!order) {
            busOrderByTrack.set(trackId, [layerId]);
            return;
        }
        if (order.includes(layerId)) {
            return;
        }
        order.push(layerId);
    };

    const removeLayerFromOrder = (trackId: string, layerId: string): void => {
        const order = busOrderByTrack.get(trackId);
        if (!order) {
            return;
        }
        const idx = order.indexOf(layerId);
        if (idx !== -1) {
            order.splice(idx, 1);
        }
        if (order.length === 0) {
            busOrderByTrack.delete(trackId);
        }
    };

    const createBus = (input: ApplyInput): LiveBus | null => {
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
        };
    };

    const finalizeDisposal = (key: RegionKey): void => {
        const live = liveBuses.get(key);
        if (!live) {
            return;
        }
        live.bus.dispose();
        liveBuses.delete(key);
        removeLayerFromOrder(live.trackId, live.layerId);
        deps.rerouteTrack(live.trackId);
        wireChain(live.trackId);
    };

    return {
        applyTick: (records): void => {
            const seen = new Set<RegionKey>();
            const touchedTracks = new Set<string>();

            for (const rec of records) {
                if (rec.effectType === 'volume' || rec.effectType === 'pan') {
                    continue;
                }
                const key = keyFor(rec.layerId, rec.trackId);
                seen.add(key);
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
                    continue;
                }
                const live = createBus(rec);
                if (live) {
                    liveBuses.set(key, live);
                    addLayerToOrder(rec.trackId, rec.layerId);
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
            busOrderByTrack.clear();
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
