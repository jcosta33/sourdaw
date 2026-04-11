import { type WAMDescriptor } from '#/modules/Plugin/models/WamPluginHostTypes';
import { registry } from './helpers';

export function registerWAMPlugin(descriptor: WAMDescriptor): void {
    registry.set(descriptor.id, descriptor);
}