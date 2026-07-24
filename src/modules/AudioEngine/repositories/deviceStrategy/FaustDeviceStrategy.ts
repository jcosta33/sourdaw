import { logger } from '#/infra/logger/appLogger';

import { type Device } from '../../models/TrackViewTypes';
import { type OfflineDeviceNode } from '../devices/types';

import { type AudioDeviceStrategy, type OfflineAutomationBinding } from './AudioDeviceStrategy';

type FaustNodeLike = AudioNode & {
    setParamValue(name: string, value: number): void;
    // A Faust AudioWorkletNode exposes each DSP parameter as a real AudioParam,
    // keyed by its full Faust address (e.g. `/dsp/cutoff`).
    parameters?: ReadonlyMap<string, AudioParam>;
};

/**
 * Map each parameter's bare name (the automation lane's parameterId) to its
 * full Faust address, so `resolveOfflineAutomation` can reach the AudioParam
 * that `node.parameters` keys by address. Mirrors the live factory's cache.
 */
function buildFaustParamAddressCache(parameters: ReadonlyMap<string, AudioParam> | undefined): Map<string, string> {
    const cache = new Map<string, string>();
    if (!parameters) {
        return cache;
    }
    for (const [key] of parameters) {
        const bareName = key.split('/').pop();
        if (!bareName) {
            continue;
        }
        const existing = cache.get(bareName);
        if (existing !== undefined) {
            // Parity with the live factory cache: keep the first address for an
            // ambiguous bare name and warn rather than silently shadowing it.
            logger.warn(`[Faust] Duplicate bare param "${bareName}" — keeping "${existing}", ignoring "${key}"`);
            continue;
        }
        cache.set(bareName, key);
    }
    return cache;
}

type FaustDeviceCreator = (input: {
    ctx: BaseAudioContext;
    faustModuleId: string;
}) => Promise<OfflineDeviceNode | null>;

export class FaustDeviceStrategy implements AudioDeviceStrategy {
    private readonly paramAddressCache: Map<string, string>;

    constructor(
        public readonly node: OfflineDeviceNode,
        private readonly faustNode: FaustNodeLike
    ) {
        this.paramAddressCache = buildFaustParamAddressCache(faustNode.parameters);
    }

    setParam(name: string, value: number): void {
        try {
            this.faustNode.setParamValue(name, value);
        } catch (error) {
            logger.warn(`[Faust] Failed to set param ${name} to ${value}:`, error);
        }
    }

    resolveOfflineAutomation(parameterId: string): OfflineAutomationBinding | null {
        const parameters = this.faustNode.parameters;
        if (!parameters) {
            return null;
        }
        const address = parameters.has(parameterId) ? parameterId : this.paramAddressCache.get(parameterId);
        const audioParam = address === undefined ? undefined : parameters.get(address);
        if (!audioParam) {
            return null;
        }
        return { kind: 'audioParam', targets: [{ audioParam, scale: 1, offset: 0 }] };
    }
}

type CreateFaustStrategyInput = {
    ctx: BaseAudioContext;
    device: Device;
    createFaustDevice: FaustDeviceCreator;
};

export async function createFaustStrategy({
    ctx,
    device,
    createFaustDevice,
}: CreateFaustStrategyInput): Promise<FaustDeviceStrategy> {
    const node = await createFaustDevice({ ctx, faustModuleId: device.type });
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
