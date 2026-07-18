import { type WAMDescriptor } from '../../../models/WamPluginHostTypes';

import { registry } from './helpers';

export function registerWAMPlugin(descriptor: WAMDescriptor): void {
    registry.set(descriptor.id, descriptor);
}
