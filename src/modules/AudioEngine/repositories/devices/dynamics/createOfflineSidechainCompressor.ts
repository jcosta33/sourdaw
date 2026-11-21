import { SIDECHAIN_COMPRESSOR_WORKLET_OPTIONS } from '../../../models/BuiltinDeviceRuntime';
import { type OfflineDeviceNode } from '../types';

import { preparedOfflineSidechainCompressors } from './prepareOfflineSidechainCompressor';

export const SIDECHAIN_PROCESSOR_UNAVAILABLE_WARNING =
    'Sidechain processor unavailable; ducking is lost and the compressor passes audio at its Makeup gain only.';

/**
 * What the sidechain worklet does with no key on input 1: no gain reduction,
 * output = input × Makeup. Used when the worklet cannot be built, so a render
 * degrades to the live device's unkeyed behaviour rather than to a different
 * compressor.
 */
function createUnkeyedMakeupNode(ctx: BaseAudioContext): OfflineDeviceNode {
    const makeup = ctx.createGain();
    makeup.gain.value = 1;
    return { inputNode: makeup, outputNode: makeup, nodes: [makeup], namedNodes: { makeup } };
}

/**
 * Build the sidechain compressor for an offline context. Live playback always
 * builds the worklet, keyed or not, so an offline render does too once its
 * module is registered on this context (`prepareOfflineContext`).
 */
export function createOfflineSidechainCompressor(ctx: BaseAudioContext): OfflineDeviceNode {
    const prepared = preparedOfflineSidechainCompressors.get(ctx);
    if (!prepared) {
        // The module failed to register; `prepareOfflineContext` already warned.
        return createUnkeyedMakeupNode(ctx);
    }
    if (typeof AudioWorkletNode === 'undefined') {
        prepared.onWarning?.(`${SIDECHAIN_PROCESSOR_UNAVAILABLE_WARNING} AudioWorkletNode is unavailable.`);
        return createUnkeyedMakeupNode(ctx);
    }
    try {
        const workletNode = new AudioWorkletNode(
            ctx,
            'sidechain-compressor-processor',
            SIDECHAIN_COMPRESSOR_WORKLET_OPTIONS
        );
        return { inputNode: workletNode, outputNode: workletNode, nodes: [workletNode] };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        prepared.onWarning?.(`${SIDECHAIN_PROCESSOR_UNAVAILABLE_WARNING} ${reason}`);
        return createUnkeyedMakeupNode(ctx);
    }
}
