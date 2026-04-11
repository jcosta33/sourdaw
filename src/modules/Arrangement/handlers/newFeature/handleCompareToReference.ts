import { createHandler } from '#/helpers/createHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { compareToReference } from '#/modules/AudioAnalysis/useCases';

export const handleCompareToReference = createHandler<'compareToReference'>({
    execute: () => {
        const result = compareToReference();
        notifyUser(
            `Mix comparison: ${result.overallScore}% match — ${result.suggestions.length} suggestions`,
            result.overallScore >= 70 ? 'success' : 'warning'
        );
    },
    describe: () => ({ label: 'Compare to Reference Mix' }),
    undoable: false,
});
