import { compareToReference } from '#/modules/AudioAnalysis/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

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
