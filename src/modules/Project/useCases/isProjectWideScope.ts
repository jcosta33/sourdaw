import { type ProductionBriefScope } from '../models/ProductionBrief';

/**
 * A project-wide protection refuses every action, so it is tested on its own.
 *
 * Single source of truth for what "the whole project" means: the batch
 * admission guard and the surface that explains a refusal read it together, so
 * neither can name a lock the other does not enforce.
 */
export function isProjectWideScope(
    scope: ProductionBriefScope
): scope is Extract<ProductionBriefScope, { kind: 'project' }> {
    return scope.kind === 'project';
}
