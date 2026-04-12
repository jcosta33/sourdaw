import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { generateAllTransitionFills } from '../../useCases/fillTransitionGeneration/generation';

export const handleGenerateAllTransitions = createHandler<'generateAllTransitions'>({
    execute: () => {
        const fills = generateAllTransitionFills();
        notifyUser(
            fills.length > 0
                ? `Generated ${fills.length} transition fills across arrangement`
                : 'No section boundaries found — add sections first',
            fills.length > 0 ? 'success' : 'warning'
        );
    },
    describe: () => ({ label: 'Generate All Transitions' }),
    undoable: true,
});
