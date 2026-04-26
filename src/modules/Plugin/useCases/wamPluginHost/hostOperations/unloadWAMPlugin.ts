import { instances } from './helpers';

export function unloadWAMPlugin(instanceId: string): void {
    const instance = instances.get(instanceId);
    if (instance) {
        if ('disconnect' in instance.audioNode) {
            instance.audioNode.disconnect();
        }
        const nodeAsUnknown: unknown = instance.audioNode;
        if ('destroy' in instance.audioNode && typeof (nodeAsUnknown as { destroy: unknown }).destroy === 'function') {
            try {
                (nodeAsUnknown as { destroy: () => void }).destroy();
            } catch {
                // ignore
            }
        }
        instances.delete(instanceId);
    }
}
