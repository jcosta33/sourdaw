import { type WAMDescriptor } from '../../../models/WamPluginHostTypes';

import { registry } from './helpers';

export function getPluginsByCategory(category: WAMDescriptor['category']): WAMDescriptor[] {
    return [...registry.values()].filter((data) => data.category === category);
}
