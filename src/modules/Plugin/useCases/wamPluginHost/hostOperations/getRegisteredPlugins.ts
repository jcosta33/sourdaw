import { type WAMDescriptor } from '#/modules/Plugin/models/WamPluginHostTypes';
import { registry } from './helpers';

export function getRegisteredPlugins(): WAMDescriptor[] {
    return [...registry.values()];
}