/**
 * Repository: Faust DSP device node factory.
 *
 * Creates OfflineDeviceNode wrappers around Faust AudioWorkletNodes,
 * making them compatible with the device chain builder.
 *
 * Since Faust nodes are single AudioNodes that handle both input and output,
 * the wrapper simply uses the same node for inputNode and outputNode.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { type OfflineDeviceNode } from './deviceNodeFactory';
import { createFaustNode, compileFaustDSP, isFaustModule } from '#/modules/Plugin/useCases/faustEngine/compilerEngine';

export { isFaustModule };

/**
 * Create a Faust device node for the device chain.
 *
 * Ensures the module is compiled, then creates an AudioWorkletNode.
 * Returns null if compilation or node creation fails — the chain builder
 * should skip this device gracefully.
 */
export const createFaustDevice = inject({ logger })(
    ({ logger }) =>
        async function createFaustDevice(
            ctx: BaseAudioContext,
            faustModuleId: string
        ): Promise<OfflineDeviceNode | null> {
            // Ensure module is compiled
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

            // Faust AudioWorkletNodes are single nodes that handle I/O
            const audioNode = node as unknown as AudioNode;
            return {
                inputNode: audioNode,
                outputNode: audioNode,
                nodes: [audioNode],
            };
        }
);
