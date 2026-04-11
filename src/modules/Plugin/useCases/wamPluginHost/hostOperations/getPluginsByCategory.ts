import { type WAMDescriptor } from '#/modules/Plugin/models/WamPluginHostTypes';
import { registry } from './helpers';

export function getPluginsByCategory(category: WAMDescriptor['category']): WAMDescriptor[] {
    return [...registry.values()].filter((d) => d.category === category);
}