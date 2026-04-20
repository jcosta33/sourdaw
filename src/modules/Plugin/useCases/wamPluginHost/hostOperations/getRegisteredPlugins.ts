import { type WAMDescriptor } from '../../../models/WamPluginHostTypes';

import { registry } from './helpers';

export function getRegisteredPlugins(): WAMDescriptor[] {
    return [...registry.values()];
}
