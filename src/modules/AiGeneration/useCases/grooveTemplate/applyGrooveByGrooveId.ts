import { getGrooveById } from '../../repositories/factoryGrooves';

import { applyGroove } from './operations/applyGroove';

export function applyGrooveByGrooveId(clipId: string, grooveId: string, amount: number): void {
    const template = getGrooveById(grooveId);
    if (!template) {
        return;
    }
    applyGroove(clipId, template, amount);
}
