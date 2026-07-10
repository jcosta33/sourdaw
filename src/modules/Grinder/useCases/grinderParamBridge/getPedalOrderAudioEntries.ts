import {
    type GrinderPedal,
    SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES,
    getGrinderSupportedChainOrder,
} from '../../models/GrinderPatch';

type PedalOrderAudioEntry = { key: string; value: number };

export function getPedalOrderAudioEntries(isPost: boolean, pedals: readonly GrinderPedal[]): PedalOrderAudioEntry[] {
    const order = getGrinderSupportedChainOrder(pedals);
    const prefix = isPost ? 'post' : 'pre';

    return SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES.map((pedal_type) => {
        const pedalName = pedal_type.charAt(0).toUpperCase() + pedal_type.slice(1);
        return {
            key: `${prefix}${pedalName}Order`,
            value: order.indexOf(pedal_type),
        };
    });
}
