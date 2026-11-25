import { valuesEqual } from '#/utils/structuralEquality';

import { type GrooveTemplate } from '../../models/GrooveTemplate';

/**
 * Whether two templates hold the same groove under the same id. The name is left out: an extraction
 * derives it from the names the pool holds when it runs, so deleting another template changes the name
 * a repeat extraction would get without changing the groove.
 */
export function hasSameGrooveContent(left: GrooveTemplate, right: GrooveTemplate): boolean {
    return valuesEqual({ ...left, name: '' }, { ...right, name: '' });
}
