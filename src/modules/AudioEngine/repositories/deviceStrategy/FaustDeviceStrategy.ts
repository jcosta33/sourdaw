import { logger } from '#/infra/logger/appLogger';

import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../devices/types';
import { createFaustDevice } from '../faustDeviceFactory';

import { type AudioDeviceStrategy } from './AudioDeviceStrategy';

type FaustNodeLike = AudioNode & {
    setParamValue(name: string, value: number): void;
};

export class FaustDeviceStrategy implements AudioDeviceStrategy {
    constructor(
        public readonly node: OfflineDeviceNode,
        private readonly faustNode: FaustNodeLike
    ) {}

    setParam(name: string, value: number): void {
        try {
            this.faustNode.setParamValue(name, value);
        } catch (error) {
            logger.warn(`[Faust] Failed to set param ${name} to ${value}:`, error);
        }
    }
}

export async function createFaustStrategy(ctx: BaseAudioContext, device: Device): Promise<FaustDeviceStrategy> {
    const node = await createFaustDevice(ctx, device.type);
    if (!node) {
        throw new Error(`Failed to create Faust device: ${device.type}`);
    }

    const faustNode = node.nodes[0] as FaustNodeLike;
    const strategy = new FaustDeviceStrategy(node, faustNode);

    // Apply initial params
    for (const [key, val] of Object.entries(device.parameterValues)) {
        strategy.setParam(key, val);
    }

    return strategy;
}
