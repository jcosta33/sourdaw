/**
 * Reviewer-model diversity check for `review:publish`.
 *
 * Enforces the AGENTS.md Review rule: "Assign reviewers a model different from
 * the author's when that set offers one; otherwise reuse the author's." The
 * authoring model is on the PR as the authorship label `lane:publish` applies
 * from the lane's recorded `--model`: a bare model-token name whose description
 * is the fence `Authored by <model>` (see `modelLabelName`/
 * `ensureModelLabelArgs` in `publishLane.ts`). The reviewer's model is the
 * `reviewerModel` field on the review document.
 *
 * The otherwise-reuse arm is deliberate, not silent: the review document must
 * carry `modelExhaustion` — one line naming what made every other model
 * unavailable — and the published body must name the reviewer model, so a
 * same-model review always discloses the deviation it rests on.
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
    modelExhaustion?: string;
    body?: string;
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
    const authorModels = input.authorLabels
        .map(authorModelFromLabel)
        .filter((model): model is string => model !== undefined);
    if (authorModels.length === 0) {
        return;
    }
    // Every fenced label is a model some lane publish declared as the author. Metadata edits are
    // add-only, so republishing a lane with a different --model leaves the previous fence on the
    // PR; a reviewer matching any declared author is the collusion this check exists to refuse.
    const reviewerModel = input.reviewerModel.trim();
    if (!authorModels.includes(reviewerModel)) {
        return;
    }
    const exhaustion = input.modelExhaustion?.trim();
    if (exhaustion === undefined || exhaustion === '') {
        fail(
            `reviewer model "${input.reviewerModel}" matches one of the PR's authoring models ` +
                `(${authorModels.join(', ')}); assign the review stance to a different model ` +
                '(AGENTS.md: "Assign reviewers a model different from the author\'s when that set offers one"), ' +
                'or, when no other model is available, carry modelExhaustion with the reason and ' +
                'name the reviewer model in the published body'
        );
    }
    if (typeof input.body !== 'string' || !input.body.includes(reviewerModel)) {
        fail(
            `the same-model fallback requires the published review body to record the deviation ` +
                `by naming the reviewer model "${reviewerModel}"`
        );
    }
}

function fail(message: string): never {
    throw new Error(message);
}
