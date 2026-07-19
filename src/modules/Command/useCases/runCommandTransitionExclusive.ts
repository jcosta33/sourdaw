import { runCommandMutationExclusive } from './commandMutation';
import { runCommandTransition } from './runCommandTransition';

/**
 * Serialize a project-identity transition with actions, undo, redo, and group
 * reversion. The supplied reset capability is valid only inside this barrier,
 * keeping state publication and history invalidation in one awaited operation.
 */
export function runCommandTransitionExclusive<Output>(
    transition: (resetUndoHistory: () => void) => Promise<Output>
): Promise<Output> {
    return runCommandMutationExclusive(() => runCommandTransition(transition));
}
