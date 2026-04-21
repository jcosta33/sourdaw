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

export type AdjustmentLayerRuntime = {
    applyTick: (records: ApplyInput[]) => void;
    getBusInputForTrack: (trackId: string) => AudioNode | null;
    reset: () => void;
    listLiveBusKeys: () => string[];
};

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

    const getBusInputForTrack = (trackId: string): AudioNode | null => {
        for (const live of liveBuses.values()) {
            if (live.trackId === trackId) {
                return live.bus.inputNode;
            }
        }
        return null;
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
        const dest = deps.getTrackDefaultDestination(input.trackId);
        if (dest) {
            bus.connectDestination(dest);
        }
        const source = deps.getTrackOutputNode(input.trackId);
        if (source) {
            bus.connectSource(source);
        }
        bus.setBlend(input.blend);
        return {
            layerId: input.layerId,
            trackId: input.trackId,
            effectType: input.effectType,
            bus,
            lastParamSignature: paramSignature(input.parameters),
            lastBlend: input.blend,
        };
    };

    const disposeBus = (live: LiveBus): void => {
        live.bus.dispose();
    };

    return {
        applyTick: (records): void => {
            const seen = new Set<RegionKey>();
            const newlyCreated = new Set<string>();
            const newlyRemoved = new Set<string>();

            for (const rec of records) {
                if (rec.effectType === 'volume' || rec.effectType === 'pan') {
                    continue;
                }
                const key = keyFor(rec.layerId, rec.trackId);
                seen.add(key);
                const existing = liveBuses.get(key);
                if (existing) {
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
                    newlyCreated.add(rec.trackId);
                }
            }

            for (const [key, live] of Array.from(liveBuses.entries())) {
                if (seen.has(key)) {
                    continue;
                }
                live.bus.setBlend(0);
                disposeBus(live);
                liveBuses.delete(key);
                newlyRemoved.add(live.trackId);
            }

            for (const trackId of newlyCreated) {
                deps.rerouteTrack(trackId);
            }
            for (const trackId of newlyRemoved) {
                if (newlyCreated.has(trackId)) {
                    continue;
                }
                deps.rerouteTrack(trackId);
            }
        },
        getBusInputForTrack,
        reset: (): void => {
            const trackIds = new Set<string>();
            for (const live of liveBuses.values()) {
                trackIds.add(live.trackId);
                disposeBus(live);
            }
            liveBuses.clear();
            for (const trackId of trackIds) {
                deps.rerouteTrack(trackId);
            }
        },
        listLiveBusKeys: (): string[] => {
            return Array.from(liveBuses.keys()).sort();
        },
    };
}
