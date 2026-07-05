import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { compareToReference } from '../../useCases/referenceMixComparison/compareToReference';

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
