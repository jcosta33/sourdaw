import { type WAMInstance } from '../../../models/WamPluginHostTypes';

import { instances } from './helpers';

export function getActiveInstances(): Map<string, WAMInstance> {
    return new Map(instances);
}
