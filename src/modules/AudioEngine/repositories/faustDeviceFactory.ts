/**
 * Repository: Faust DSP device node factory.
 *
 * Creates OfflineDeviceNode wrappers around Faust AudioWorkletNodes,
 * making them compatible with the device chain builder.
 *
 * Since Faust nodes are single AudioNodes that handle both input and output,
 * the wrapper simply uses the same node for inputNode and outputNode.
 */

import { type IFaustMonoWebAudioNode, type IFaustPolyWebAudioNode } from '@grame/faustwasm';

import { logger } from '#/infra/logger/appLogger';
import { compileFaustDSP, createFaustNode, isFaustModule } from '#/modules/Plugin/useCases';

import { type OfflineDeviceNode } from './deviceNodeFactory';

export { isFaustModule };

type FaustNode = IFaustMonoWebAudioNode | IFaustPolyWebAudioNode;

/**
 * Create a Faust device node for the device chain.
 *
 * Ensures the module is compiled, then creates an AudioWorkletNode.
 * Returns null if compilation or node creation fails — the chain builder
 * should skip this device gracefully.
 */
export async function createFaustDevice(
    ctx: BaseAudioContext,
    faustModuleId: string
): Promise<OfflineDeviceNode | null> {
    const compiled = await compileFaustDSP(faustModuleId);
    if (!compiled) {
        logger.warn(`[FaustDevice] Failed to compile ${faustModuleId}`);
        return null;
    }

    const node = await createFaustNode(faustModuleId, ctx);
    if (!node) {
        logger.warn(`[FaustDevice] Failed to create node for ${faustModuleId}`);
        return null;
    }

    const paramAddressCache = buildParamAddressCache(node);

    // keyOn/keyOff in @grame/faustwasm are port.postMessage calls; they are NOT
    // sample-accurate. We schedule them via setTimeout relative to ctx.currentTime
    // so timeline-scheduled notes still fire near their target time. Jitter is
    // bounded by timer resolution + postMessage latency (~1–15 ms). For tighter
    // scheduling a processor-side look-ahead scheduler would be required.
    const scheduleCall = (time: number | undefined, call: () => void): void => {
        if (time !== undefined && time > ctx.currentTime) {
            setTimeout(call, (time - ctx.currentTime) * 1000);
            return;
        }
        call();
    };

    return {
        inputNode: node,
        outputNode: node,
        nodes: [node],
        wamControls: {
            setParam: (name: string, value: number) => {
                const resolved = paramAddressCache.get(name) ?? name;
                try {
                    node.setParamValue(resolved, value);
                } catch (error) {
                    logger.warn(`[FaustDevice] Failed to set param ${resolved} to ${value}:`, error);
                }
            },
            scheduleParam: (name: string, value: number, time: number) => {
                if (!(node instanceof AudioWorkletNode)) {
                    return;
                }
                const resolved = paramAddressCache.get(name) ?? name;
                const targetParam = node.parameters.get(resolved);
                if (targetParam) {
                    targetParam.setValueAtTime(value, time);
                }
            },
            keyOn: (channel: number, pitch: number, velocity: number, time?: number) => {
                if ('keyOn' in node) {
                    scheduleCall(time, () => node.keyOn(channel, pitch, velocity));
                }
            },
            keyOff: (channel: number, pitch: number, velocity: number, time?: number) => {
                if ('keyOff' in node) {
                    scheduleCall(time, () => node.keyOff(channel, pitch, velocity));
                }
            },
            destroy: () => {
                try {
                    node.destroy();
                } catch (error) {
                    logger.warn(`[FaustDevice] Failed to destroy node:`, error);
                }
            },
        },
    };
}

function buildParamAddressCache(node: FaustNode): Map<string, string> {
    const cache = new Map<string, string>();
    if (!(node instanceof AudioWorkletNode)) {
        return cache;
    }
    for (const [key] of node.parameters) {
        const bareName = key.split('/').pop();
        if (!bareName) {
            continue;
        }
        const existing = cache.get(bareName);
        if (existing !== undefined) {
            logger.warn(
                `[FaustDevice] Duplicate bare param "${bareName}" — keeping "${existing}", ignoring "${key}"`
            );
            continue;
        }
        cache.set(bareName, key);
    }
    return cache;
}
