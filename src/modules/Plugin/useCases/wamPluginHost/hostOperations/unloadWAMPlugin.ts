import { instances } from './helpers';

export function unloadWAMPlugin(instanceId: string): void {
    const instance = instances.get(instanceId);
    if (instance) {
        if ('disconnect' in instance.audioNode) {
            instance.audioNode.disconnect();
        }
        if ('destroy' in instance.audioNode && typeof (instance.audioNode as any).destroy === 'function') {
            try {
                (instance.audioNode as any).destroy();
            } catch {
                // ignore
            }
        }
        instances.delete(instanceId);
    }
}
