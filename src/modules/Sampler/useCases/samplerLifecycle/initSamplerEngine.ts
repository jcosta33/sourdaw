import { createSamplerInstance } from '../../repositories/samplerBridge';
import { setInstanceId } from '../../stores/samplerStore';

export async function initSamplerEngine(instanceId: string, sampleRate: number): Promise<void> {
    setInstanceId(instanceId);
    await createSamplerInstance(instanceId, sampleRate);
}