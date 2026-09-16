/**
 * Reviewer-model diversity check for `review:publish`.
 *
 * Enforces the AGENTS.md Review rule: "Assign reviewers a model different
 * from the author's when that set offers one." The authoring model is on the
 * PR as the authorship label `lane:publish` applies from the lane's recorded
 * `--model`: a bare model-token name whose description is the fence
 * `Authored by <model>` (see `modelLabelName`/`ensureModelLabelArgs` in
 * `publishLane.ts`). The reviewer's model is the `reviewerModel` field on
 * the review document.
 */
import { ORCHESTRATOR_USER_NODE_ID } from './githubAppIdentity.ts';

export type AuthorshipLabel = { name: string; description?: string };

/** Matches the fence `publishLane.ts` writes; names alone never mark authorship. */
function authorModelFromLabel(label: AuthorshipLabel): string | undefined {
    if (typeof label.description !== 'string' || !label.description.startsWith('Authored by ')) {
        return undefined;
    }
    return label.description.slice('Authored by '.length);
}

export function assertReviewerModelDiversity(input: {
    actorNodeId: string;
    authorLabels: readonly AuthorshipLabel[];
    reviewerModel: string | undefined;
}): void {
    if (input.actorNodeId === ORCHESTRATOR_USER_NODE_ID) {
        return;
    }
    if (input.reviewerModel === undefined || input.reviewerModel.trim() === '') {
        fail(
            'review.json must carry reviewerModel (the model that performed the review stance, ' +
                'e.g. "glm-5.3-flash"); the reviewer-diversity rule cannot be checked without it'
        );
    }
    const authorModel = input.authorLabels
        .map(authorModelFromLabel)
        .find((model): model is string => model !== undefined);
    if (authorModel === undefined) {
        return;
    }
    if (authorModel === input.reviewerModel.trim()) {
        fail(
            `reviewer model "${input.reviewerModel}" matches the PR's authoring model; ` +
                'assign the review stance to a different model (AGENTS.md: "Assign reviewers a model ' +
                'different from the author\'s")'
        );
    }
}

function fail(message: string): never {
    throw new Error(message);
}
