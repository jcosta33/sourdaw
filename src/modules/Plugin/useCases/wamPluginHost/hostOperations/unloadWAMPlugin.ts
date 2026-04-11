import { instances } from './helpers';

export function unloadWAMPlugin(instanceId: string): void {
    const instance = instances.get(instanceId);
    if (instance) {
        if ('disconnect' in instance.audioNode) {
            instance.audioNode.disconnect();
        }
        instances.delete(instanceId);
    }
}