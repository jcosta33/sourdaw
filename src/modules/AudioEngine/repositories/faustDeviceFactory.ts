/**
 * Repository: Faust DSP device node factory.
 *
 * Creates OfflineDeviceNode wrappers around Faust AudioWorkletNodes,
 * making them compatible with the device chain builder.
 *
 * Since Faust nodes are single AudioNodes that handle both input and output,
 * the wrapper simply uses the same node for inputNode and outputNode.
 */

import { logger } from '#/infra/logger/appLogger';
import { compileFaustDSP, createFaustNode, isFaustModule } from '#/modules/Plugin/useCases';

import { type OfflineDeviceNode } from './deviceNodeFactory';

export { isFaustModule };

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

    const audioNode = node as unknown as AudioNode;
    return {
        inputNode: audioNode,
        outputNode: audioNode,
        nodes: [audioNode],
        wamControls: {
            setParam: (name: string, value: number) => {
                // Resolve bare param names to full Faust addresses via suffix fallback.
                // Faust expects addresses like '/FM_Synth/algorithm'; UI passes 'algorithm'.
                if (node && typeof (node as any).setParamValue === 'function') {
                    if (audioNode instanceof AudioWorkletNode) {
                        let resolvedName = name;
                        if (!audioNode.parameters.get(name)) {
                            for (const [key] of audioNode.parameters) {
                                if (key.endsWith(`/${name}`)) {
                                    resolvedName = key;
                                    break;
                                }
                            }
                        }
                        try {
                            (node as any).setParamValue(resolvedName, value);
                        } catch (error) {
                            logger.warn(`[FaustDevice] Failed to set param ${resolvedName} to ${value}:`, error);
                        }
                    } else {
                        try {
                            (node as any).setParamValue(name, value);
                        } catch (error) {
                            logger.warn(`[FaustDevice] Failed to set param ${name} to ${value}:`, error);
                        }
                    }
                }
            },
            scheduleParam: (name: string, value: number, time: number) => {
                if (audioNode instanceof AudioWorkletNode) {
                    let targetParam: AudioParam | null = null;
                    const exact = audioNode.parameters.get(name);
                    if (exact) {
                        targetParam = exact;
                    } else {
                        for (const [key, param] of audioNode.parameters) {
                            if (key.endsWith(`/${name}`)) {
                                targetParam = param;
                                break;
                            }
                        }
                    }
                    if (targetParam) {
                        targetParam.setValueAtTime(value, time);
                    }
                }
            },
            destroy: () => {
                if ('destroy' in audioNode && typeof (audioNode as any).destroy === 'function') {
                    try {
                        (audioNode as any).destroy();
                    } catch (error) {
                        logger.warn(`[FaustDevice] Failed to destroy node:`, error);
                    }
                }
            },
        },
    };
}
