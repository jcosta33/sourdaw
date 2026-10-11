import { AdjustmentBusNode } from '../../engine/AdjustmentBusNode';

import { type OfflineAdjustmentDspLayerPlan } from './offlineAdjustmentLayers';

/**
 * The offline insertion of a track's DSP adjustment layers — the same bus
 * topology live playback builds in `AdjustmentLayerRuntime`: one wet/dry bus
 * per layer, chained in project stack order, with the track's output feeding
 * the first bus and the last bus feeding the track's real destination. The
 * bus node itself is the live `AdjustmentBusNode` reused unchanged (it only
 * asks for a `BaseAudioContext`, which an `OfflineAudioContext` is); the
 * wrapper exists because the offline blend must land at once rather than
 * gliding on live's 50 ms time constant from a constructor-initialised zero.
 */
const OFFLINE_BLEND_TIME_CONSTANT_SECONDS = 0.001;

export type OfflineAdjustmentBus = {
    inputNode: AudioNode;
    outputNode: AudioNode;
    /** Move the wet/dry crossfade — a block sample when the layer's blend moves. */
    setBlend: (blend: number) => void;
    dispose: () => void;
};

export function createOfflineAdjustmentBusChain(input: {
    context: BaseAudioContext;
    layers: readonly OfflineAdjustmentDspLayerPlan[];
}): OfflineAdjustmentBus[] {
    return input.layers.map((layer) => {
        const bus = new AdjustmentBusNode({
            context: input.context,
            effectType: layer.effectType,
            parameters: layer.parameters,
        });
        // Live's `createBus` seeds the blend when the bus is created; the
        // wrapper keeps the same call on the offline time constant so the
        // crossfade is at the layer's blend for effectively the whole render.
        bus.setBlend(layer.blend, OFFLINE_BLEND_TIME_CONSTANT_SECONDS);
        return {
            inputNode: bus.inputNode,
            outputNode: bus.outputNode,
            setBlend: (blend: number) => {
                bus.setBlend(blend, OFFLINE_BLEND_TIME_CONSTANT_SECONDS);
            },
            dispose: () => {
                bus.dispose();
            },
        };
    });
}
