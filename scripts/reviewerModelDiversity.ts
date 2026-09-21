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
 *
 * When the dossier's per-draw records travel with the check, the same disclosure
 * holds per draw: a draw whose model matches an authoring fence is disclosed by
 * its own `exhaustion`, or by a document-level `modelExhaustion` whose whole-round
 * claim the round's own record supports — the field present, the document reviewer
 * model itself on an author fence, and no dispatched draw on another model. A
 * mixed round is admitted by per-draw exhaustion without a document-level one.
 * Without per-draw records the document-level rules apply alone, exactly as they
 * always have.
 */
import { ORCHESTRATOR_USER_NODE_ID } from './githubAppIdentity.ts';

export type AuthorshipLabel = { name: string; description?: string };

/** One completed review draw: one stance performed by one reviewer model. */
export type ReviewerStanceDraw = {
    stance: string;
    reviewerModel: string;
    /** Present only when this draw reused an authoring model: what made every other model unavailable. */
    exhaustion?: string;
};

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
};

/**
 * Per-draw disclosure: a draw on an authoring model is disclosed by its own exhaustion line, or by
 * a document-level `modelExhaustion` whose whole-round claim the round's own record supports — the
 * field present and non-blank, the document reviewer model itself on an author fence, and no
 * dispatched draw off the fences. A blank field, a field refuted by an off-fence draw, or a stale
 * field on an unfenced document model discloses nothing; with no cover the draw is an undisclosed
 * same-model review, and the refusal names the stance and model.
 */
function assertEveryDrawDisclosesAuthorFallback(
    authorModels: readonly string[],
    stanceDraws: readonly ReviewerStanceDraw[],
    documentReviewerModel: string,
    modelExhaustion: string | undefined
): void {
    // The whole-round arm covers a draw only when the round is whole-round by its own record:
    // a blank field, a refuted round, or a stale document model leaves the draw uncovered.
    const wholeRoundExhaustion = modelExhaustion?.trim() ?? '';
    const roundIsWholeRound =
        wholeRoundExhaustion !== '' &&
        authorModels.includes(documentReviewerModel.trim()) &&
        stanceDraws.every((draw) => authorModels.includes(draw.reviewerModel.trim()));
    for (const draw of stanceDraws) {
        if (!authorModels.includes(draw.reviewerModel.trim())) {
            continue;
        }
        if ((draw.exhaustion ?? '').trim() !== '' || roundIsWholeRound) {
            continue;
        }
        fail(
            `review stance "${draw.stance}" drew reviewer model "${draw.reviewerModel}", which matches one of ` +
                `the PR's authoring models (${authorModels.join(', ')}); assign that draw to a different ` +
                'model, or, when no other model is available, record its exhaustion on the dossier draw'
        );
    }
}

export function assertReviewerModelDiversity(input: {
    actorNodeId: string;
    authorLabels: readonly AuthorshipLabel[];
    document: ReviewerModelDocument;
    stanceDraws?: readonly ReviewerStanceDraw[];
}): void {
    if (input.actorNodeId === ORCHESTRATOR_USER_NODE_ID) {
        return;
    }
    const reviewerModel = input.document.reviewerModel;
    if (reviewerModel === undefined || reviewerModel.trim() === '') {
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
    const trimmedModel = reviewerModel.trim();
    assertEveryDrawDisclosesAuthorFallback(
        authorModels,
        input.stanceDraws ?? [],
        trimmedModel,
        input.document.modelExhaustion
    );
    if (!authorModels.includes(trimmedModel)) {
        return;
    }
    const exhaustion = input.document.modelExhaustion?.trim();
    // A mixed round — only some stances fell back — discloses through the fallen-back draw's own
    // exhaustion instead of a whole-round document-level field; the body names the model either way.
    const mixedRoundExcuse = (input.stanceDraws ?? []).some(
        (draw) => draw.reviewerModel.trim() === trimmedModel && (draw.exhaustion ?? '').trim() !== ''
    );
    if ((exhaustion === undefined || exhaustion === '') && !mixedRoundExcuse) {
        fail(
            `reviewer model "${reviewerModel}" matches one of the PR's authoring models ` +
                `(${authorModels.join(', ')}); assign the review stance to a different model ` +
                '(AGENTS.md: "Assign reviewers a model different from the author\'s when that set offers one"), ' +
                'or, when no other model is available, carry modelExhaustion with the reason and ' +
                'name the reviewer model in the published body'
        );
    }
    if (!bodyNamesModel(input.document.body, trimmedModel)) {
        fail(
            `the same-model fallback requires the published review body to record the deviation ` +
                `by naming the reviewer model "${trimmedModel}"`
        );
    }
}

/**
 * The model named as a standalone token, not a substring: model tokens share a charset
 * (`a-z0-9.+-`, the lane `--model` grammar), so a body naming only `glm-5.3-flash` must not
 * count as naming `glm-5.3` — the flank characters prove a different, longer token.
 */
function bodyNamesModel(body: string, model: string): boolean {
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
