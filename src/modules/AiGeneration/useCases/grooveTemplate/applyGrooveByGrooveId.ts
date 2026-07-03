import { type GrooveTemplate } from '../../models/GrooveTemplate';
import { getGrooveById } from '../../repositories/factoryGrooves';

import { extractedGrooves } from './extractedGrooveRegistry';
import { applyGroove } from './operations/applyGroove';

function resolveGroove(grooveId: string): GrooveTemplate | undefined {
    return extractedGrooves.get(grooveId) ?? getGrooveById(grooveId);
}

export function applyGrooveByGrooveId(clipId: string, grooveId: string, amount: number): void {
    const template = resolveGroove(grooveId);
    if (!template) {
        return;
    }
    applyGroove(clipId, template, amount);
}
