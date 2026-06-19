import { type GrooveTemplate } from '../../models/GrooveTemplate';
import { getGrooveById } from '../../repositories/factoryGrooves';

import { applyGroove } from './operations/applyGroove';

/**
 * In-memory registry of grooves extracted at runtime (e.g. via the
 * `extractGroove` action). `extractGroove` mints templates with synthetic ids
 * (`extracted-<clipId>`) that the factory roster does not know about, so
 * without this registry an extracted groove could never be re-applied — the
 * extract action was a user-visible no-op. Lookups consult this registry first
 * and fall back to the factory grooves, so factory ids keep working unchanged.
 */
const extractedGrooves = new Map<string, GrooveTemplate>();

/** Persist an extracted groove so {@link applyGrooveByGrooveId} can find it. */
export function registerExtractedGroove(template: GrooveTemplate): void {
    extractedGrooves.set(template.id, template);
}

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
