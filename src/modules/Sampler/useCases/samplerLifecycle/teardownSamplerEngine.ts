import * as bridge from '../../repositories/samplerBridge';

export async function teardownSamplerEngine(instanceId: string): Promise<void> {
    await bridge.destroySamplerInstance(instanceId);
}