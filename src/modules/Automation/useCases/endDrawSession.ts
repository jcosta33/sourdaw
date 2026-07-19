import { runLegacyCommandMutation } from '#/modules/Command/useCases';

import { commitEndDrawSession } from './commitEndDrawSession';

/**
 * End the draw session and register an undo entry.
 */
export function endDrawSession(): void {
    void runLegacyCommandMutation(commitEndDrawSession);
}
