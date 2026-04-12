import { destroySamplerInstance } from '../../repositories/samplerBridge';

export async function teardownSamplerEngine(instanceId: string): Promise<void> {
    await destroySamplerInstance(instanceId);
}