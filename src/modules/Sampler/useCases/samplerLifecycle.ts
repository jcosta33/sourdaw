/**
 * Sampler engine lifecycle management.
 * Creates and destroys backend sampler instances via IPC.
 */

import * as bridge from '../repositories/samplerBridge';
import { setInstanceId } from '../stores/samplerStore';

export async function initSamplerEngine(instanceId: string, sampleRate: number): Promise<void> {
    setInstanceId(instanceId);
    await bridge.createSamplerInstance(instanceId, sampleRate);
}

export async function teardownSamplerEngine(instanceId: string): Promise<void> {
    await bridge.destroySamplerInstance(instanceId);
}
