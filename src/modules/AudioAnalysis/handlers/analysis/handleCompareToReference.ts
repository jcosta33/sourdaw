import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { compareToReference } from '../../useCases/referenceMixComparison/compareToReference';

const UNAVAILABLE_REASONS = {
    'no-program-audio': 'no program audio is available to measure — render or select audible material first',
    'silent-program-audio': 'the available program audio is silent',
} as const;

export const handleCompareToReference = createHandler<'compareToReference'>({
    execute: () => {
        const result = compareToReference();
        if ('status' in result) {
            notifyUser(`Mix comparison unavailable: ${UNAVAILABLE_REASONS[result.reason]}`, 'warning');
            return;
        }
        notifyUser(
            `Mix comparison vs built-in mastered target: ${result.overallScore}% match — ${result.suggestions.length} suggestions`,
            result.overallScore >= 70 ? 'success' : 'warning'
        );
    },
    describe: () => ({ label: 'Compare to Reference Mix' }),
    undoable: false,
});
