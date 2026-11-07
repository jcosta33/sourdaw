import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { querySemanticProject } from '#/modules/Project/useCases';

import { settledProjectContentMatches } from './settledProjectContentMatches';

export type AnswerQueryPageSource = {
    queryType: string;
    itemCount: number;
    total: number;
    input: Parameters<typeof querySemanticProject>[0];
    sourceRevision: string;
    equivalentRevision: string | null;
    warnings: string[];
};

/** Bind only a stable, complete owner receipt to the admitted revision without changing either revision. */
export function readAnswerProjectQuery(input: Parameters<typeof querySemanticProject>[0], frozenRevision: string) {
    const matches = settledProjectContentMatches(frozenRevision);
    const before = captureProjectRevision();
    const receipt = querySemanticProject(input);
    const after = captureProjectRevision();
    const sourceRevision = JSON.stringify(receipt.revision);
    return {
        receipt,
        sourceRevision,
        equivalentRevision: matches && before === after && sourceRevision === before ? frozenRevision : null,
    };
}
