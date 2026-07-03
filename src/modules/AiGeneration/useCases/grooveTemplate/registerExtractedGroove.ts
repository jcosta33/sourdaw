import { type GrooveTemplate } from '../../models/GrooveTemplate';

import { extractedGrooves } from './extractedGrooveRegistry';

/** Persist an extracted groove so `applyGrooveByGrooveId` can find it. */
export function registerExtractedGroove(template: GrooveTemplate): void {
    extractedGrooves.set(template.id, template);
}
