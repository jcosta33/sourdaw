/**
 * Fresh reviewer-model cost and diversity checks for `review:publish`.
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
 * same-model review always discloses the deviation it rests on. The same
 * disclosure covers every draw the document records (ADR 0054): any draw on an
 * authoring model needs the document's `modelExhaustion` and its model named in
 * the body.
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

/** The review-document fields the diversity rule reads; structural so specs pass plain objects. */
export type ReviewerModelDocument = {
    reviewerModel?: string;
    modelExhaustion?: string;
    body: string;
    draws?: readonly { stance: string; reviewerModel: string; tier?: string }[];
};

/** Fresh publication alone calls this; canonical historical parsers retain every recorded tier. */
export function assertReviewModelEligible(_model: string, label: string, tier?: string): void {
    if (tier !== undefined && tier !== 'economy' && tier !== 'standard') {
        fail(`${label} must use economy or standard review tier; strongest is historical metadata only`);
    }
}

export function assertReviewerModelDiversity(input: {
    actorNodeId: string;
    authorLabels: readonly AuthorshipLabel[];
    document: ReviewerModelDocument;
}): void {
    if (input.actorNodeId === ORCHESTRATOR_USER_NODE_ID) {
        return;
    }
    const reviewerModel = input.document.reviewerModel;
    if (reviewerModel === undefined || reviewerModel.trim() === '') {
        fail(
            'review.json must carry reviewerModel (the model that performed the review stance, ' +
                'e.g. "gpt-6-luna"); the reviewer-diversity rule cannot be checked without it'
        );
    }
    assertLaneModelSpelling(reviewerModel, 'review.json reviewerModel');
    for (const [index, draw] of (input.document.draws ?? []).entries()) {
        const label = `review.json draws[${index}].reviewerModel`;
        assertReviewModelEligible(draw.reviewerModel, label, draw.tier);
        assertLaneModelSpelling(draw.reviewerModel, label);
    }
    const authorModels = input.authorLabels.flatMap((label) => {
        const model = authorModelFromLabel(label);
        return model === undefined ? [] : [modelToken(model)];
    });
    // Every fenced label names a model some lane publish declared as the author. A republish
    // reconciles the fence: the publisher's metadata edit removes every superseded authorship
    // label (#4296), so the set the pull request wears names the model its latest publish
    // declared. A reviewer matching any declared author is the collusion this check exists
    // to refuse.
    const models = [reviewerModel, ...(input.document.draws ?? []).map((draw) => draw.reviewerModel)];
    for (const model of new Set(models.map(modelToken))) {
        if (authorModels.includes(model)) {
            assertSameModelDisclosed(input.document, model, authorModels);
        }
    }
}

/**
 * The lane `--model` grammar, copied from `AUTHOR_MODEL_PATTERN` in `scripts/openLane.ts`: importing
 * the lane opener would pull its git and filesystem graph into the review closure.
 */
const LANE_MODEL_PATTERN = /^[a-z0-9][a-z0-9.+-]{0,39}$/u;

/**
 * A reviewer model outside the lane grammar after normalisation cannot be compared with an authoring
 * label: an invisible or separator character would make the author's own model read as another.
 */
function assertLaneModelSpelling(model: string, label: string): void {
    if (!LANE_MODEL_PATTERN.test(modelToken(model))) {
        fail(
            `${label} is not a lane model name: after NFKC, trim and lowercase it must match ` +
                `${LANE_MODEL_PATTERN.source} (no spaces, invisible or combining characters)`
        );
    }
}

/** Case and compatibility-width spellings of one model name one model. */
function modelToken(model: string): string {
    return model.normalize('NFKC').trim().toLowerCase();
}

function assertSameModelDisclosed(
    document: ReviewerModelDocument,
    model: string,
    authorModels: readonly string[]
): void {
    const exhaustion = document.modelExhaustion?.trim();
    if (exhaustion === undefined || exhaustion === '') {
        fail(
            `reviewer model "${model}" matches one of the PR's authoring models ` +
                `(${authorModels.join(', ')}); assign the review stance to a different model ` +
                '(AGENTS.md: "Assign reviewers a model different from the author\'s when that set offers one"), ' +
                'or, when no other model is available, carry modelExhaustion with the reason and ' +
                'name the reviewer model in the published body'
        );
    }
    if (!bodyNamesModel(document.body, model)) {
        fail(
            `the same-model fallback requires the published review body to record the deviation ` +
                `by naming the reviewer model "${model}"`
        );
    }
}

/**
 * The model named as a standalone token, not a substring: model tokens share a charset
 * (`a-z0-9.+-`, the lane `--model` grammar), so a body naming only `glm-5.3-flash` must not
 * count as naming `glm-5.3` — the flank characters prove a different, longer token. The body is
 * compared in the same normalised form as the model token.
 */
function bodyNamesModel(publishedBody: string, model: string): boolean {
    const body = modelToken(publishedBody);
    const tokenCharacter = /[a-z0-9.+-]/u;
    for (let index = body.indexOf(model); index !== -1; index = body.indexOf(model, index + 1)) {
        const before = index > 0 ? body[index - 1] : undefined;
        const after = index + model.length < body.length ? body[index + model.length] : undefined;
        if (
            (before === undefined || !tokenCharacter.test(before)) &&
            (after === undefined || !tokenCharacter.test(after))
        ) {
            return true;
        }
    }
    return false;
}

function fail(message: string): never {
    throw new Error(message);
}
