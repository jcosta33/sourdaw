/**
 * Bundle-side dossier work for review publication (#3375, spec #3367 AC-004; ADR 0054): the round
 * freeze, deriving the canonical dossier from review.json before the POST, replaying an
 * already-recorded publication instead of re-posting, and binding the landed review's public ids
 * into the record after the POST.
 *
 * Split out of publishReview.ts to keep that module under the script-file line ceiling; the
 * publication flow itself stays there.
 */

import { join } from 'node:path';

import { fail } from './prContract.ts';
import {
    readBundleGeneratedSet,
    readReviewBundleContext,
    reviewBundlePath,
    type ReviewBundleContext,
} from './prepareReview.ts';
import { reconstructReviewRounds } from './reconstructReviewRounds.ts';
import { renderReviewDocumentBody } from './reviewApprovalFormat.ts';
import {
    REVIEW_DOSSIER_FORMAT,
    appendReviewDossierEvents,
    authorizedEvidenceDigest,
    parseReviewDossier,
} from './reviewDossier.ts';
import { serializeReviewDossier } from './reviewDossierChain.ts';
import { buildReviewDossier, persistedReviewDossier } from './reviewDossierPublication.ts';
import {
    acceptedFindings,
    completedStances,
    deliveryAuthorization,
    publishedFindings,
    publishedReviewId,
} from './reviewDossierViews.ts';
import { recordedReviewStands } from './reviewPublicationRemoteInspection.ts';
import { parseReviewRiskPlan, type ReviewRiskPlan } from './reviewRiskPolicy.ts';
import { assertReviewRoundsBelowFreeze, countReviewerRequestChangesRounds } from './reviewRoundEscalation.ts';
import { assertReviewDrawFloor, assertReviewEvidenceClaimsSafe } from './reviewStructuralAdmission.ts';

import type { PublishReviewPort } from './publishReview.ts';
import type { ReviewState } from './pullRequestReviewState.ts';
import type { DeliveryAuthorization, ReviewDocument } from './reviewDocumentParser.ts';

const REVIEW_RISK_PLAN_NAME = 'risk-plan.json';
const REVIEW_DOSSIER_NAME = 'dossier.json';
/** Caller documents the retired contract required; ADR 0054 reads none of them. */
const RETIRED_CALLER_DOCUMENTS = ['stances.json', 'discarded.json', 'reassessment.json'] as const;

type BundleFileRead = { present: true; value: unknown } | { present: false };

/**
 * The publication port signals an absent bundle file by throwing, and a file that does not parse
 * arrives the same way. The port's own existence probe tells the two apart, so a file that is
 * present but unparseable is refused here instead of being mistaken for an absent legacy artifact.
 */
function readBundleFile(port: PublishReviewPort, path: string): BundleFileRead {
    try {
        return { present: true, value: port.readReviewJson(path) };
    } catch {
        if (port.bundleFileExists(path)) {
            fail(`review bundle file at ${path} does not parse`);
        }
        return { present: false };
    }
}

function assertReviewRiskPlanBindsBundle(number: number, head: string, plan: ReviewRiskPlan, bundle: string): void {
    let manifest: ReviewBundleContext;
    try {
        manifest = readReviewBundleContext(bundle);
    } catch {
        fail(`review risk plan has no readable bundle manifest at ${join(bundle, 'manifest.json')}`);
    }
    if (plan.pr !== number) {
        fail(`review risk plan pr ${plan.pr} does not match pull request ${number}`);
    }
    if (plan.headSha !== head) {
        fail(`review risk plan headSha ${plan.headSha} does not match the live head ${head}`);
    }
    if (plan.pr !== manifest.pr) {
        fail(`review risk plan pr ${plan.pr} does not match the bundle manifest pr ${manifest.pr}`);
    }
    if (plan.headSha !== manifest.headSha) {
        fail(`review risk plan headSha ${plan.headSha} does not match the bundle manifest headSha ${manifest.headSha}`);
    }
    if (plan.baseSha !== manifest.baseSha) {
        fail(`review risk plan baseSha ${plan.baseSha} does not match the bundle manifest baseSha ${manifest.baseSha}`);
    }
}

function persistCanonicalReviewDossier(
    publication: ReturnType<typeof buildReviewDossier>,
    bundle: string,
    port: PublishReviewPort
): void {
    if (publication.fromPersisted) {
        return;
    }
    if (port.writeBundleText === undefined) {
        fail(`review publication cannot write ${join(bundle, REVIEW_DOSSIER_NAME)}: the port has no bundle writer`);
    }
    port.writeBundleText(join(bundle, REVIEW_DOSSIER_NAME), publication.canonical);
}

/**
 * The reviewer REQUEST_CHANGES rounds the pull request's public history records, read from the
 * public channels alone. Fails closed when the port cannot read them, because a run that cannot
 * count the rounds cannot decide the freeze.
 */
function observedReviewRoundCount(number: number, head: string, port: PublishReviewPort): number {
    if (port.publicReviews === undefined || port.publicReviewComments === undefined) {
        fail('the review round freeze requires the port to read the pull request public reviews and comments');
    }
    const reviews = port.publicReviews;
    const comments = port.publicReviewComments;
    return countReviewerRequestChangesRounds(
        reconstructReviewRounds(number, { state: 'OPEN', head }, reviews(number), comments(number))
    );
}

/**
 * Whether this run replays a review its plan-carrying bundle already records. A replay posts
 * nothing: the gates that bound a fresh post — the round freeze and reviewer diversity — already
 * admitted the recorded review, and `recordedPublicationReplay` proves it still stands exact.
 */
export function bundleReplaysRecordedPublication(bundle: string, port: PublishReviewPort): boolean {
    return hasRiskPlan(bundle, port) && bundleRecordsPublication(bundle, port);
}

/**
 * The round freeze (ADR 0054), decided before approval context and comment preflight so a frozen
 * pull request is told so before anything else is read (#4754). A replay is exempt: the replayed
 * review is one of the counted rounds.
 */
export function assertReviewRoundPublicationAdmitted(input: {
    number: number;
    head: string;
    bundle: string;
    port: PublishReviewPort;
}): void {
    if (bundleReplaysRecordedPublication(input.bundle, input.port)) {
        return;
    }
    assertReviewRoundsBelowFreeze(input.number, observedReviewRoundCount(input.number, input.head, input.port));
}

/**
 * One log line naming the retired caller documents a bundle still carries, so an operator following
 * the old procedure learns they changed nothing. A `dossier.json` that is not the canonical record
 * is a retired caller input too; the derived record replaces it.
 */
function logIgnoredCallerDocuments(
    bundle: string,
    dossierRead: BundleFileRead | undefined,
    port: PublishReviewPort
): void {
    const ignored: string[] = RETIRED_CALLER_DOCUMENTS.filter((name) => port.bundleFileExists(join(bundle, name)));
    if (dossierRead?.present === true && persistedReviewDossier(dossierRead.value) === undefined) {
        ignored.push(`${REVIEW_DOSSIER_NAME} (caller input)`);
    }
    if (ignored.length > 0) {
        port.log(`review:publish ignores ${ignored.join(', ')} in ${bundle}: review.json is the only caller document`);
    }
}

/**
 * Whether the bundle carries a risk plan, and so a risk plan's gate. The plan's presence is what
 * distinguishes a bundle prepared under the current contract from a legacy one, whose dossier the
 * round-cap decision must not read on its behalf (#4754).
 */
function hasRiskPlan(bundle: string, port: PublishReviewPort): boolean {
    return readBundleFile(port, join(bundle, REVIEW_RISK_PLAN_NAME)).present;
}

/**
 * Whether a plan-carrying bundle's dossier already records its publication. A retired caller input
 * in `dossier.json`, or a persisted record whose POST never landed its binding, records no
 * publication and answers false.
 * The dossier's own presence gates the read, so a legacy bundle that carries none answers false
 * without the caller having to establish the risk plan first.
 */
function bundleRecordsPublication(bundle: string, port: PublishReviewPort): boolean {
    return bundleRecordedPublicationId(bundle, port) !== undefined;
}

function bundleRecordedPublicationId(bundle: string, port: PublishReviewPort): number | undefined {
    const dossierRead = readBundleFile(port, join(bundle, REVIEW_DOSSIER_NAME));
    if (!dossierRead.present) {
        return undefined;
    }
    const value = dossierRead.value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return undefined;
    }
    if ((value as { format?: unknown }).format !== REVIEW_DOSSIER_FORMAT) {
        return undefined;
    }
    return publishedReviewId(parseReviewDossier(value));
}

/**
 * Fresh reviewer publications derive and persist the head-bound record before the POST (ADR 0054).
 * The orchestrator's acceptance document is not a review round record, so it never reaches here. A
 * fresh plan-carrying round must meet the plan's draw floor; an exact replay and a recovered binding
 * of a review that already landed are exempt.
 */
export function prepareReviewDossierPublication(input: {
    number: number;
    head: string;
    bundle: string;
    document: ReviewDocument;
    port: PublishReviewPort;
    recovered?: boolean;
}): void {
    const planPath = join(input.bundle, REVIEW_RISK_PLAN_NAME);
    const planRead = readBundleFile(input.port, planPath);
    if (!planRead.present) {
        // Legacy compatibility: a bundle whose manifest was prepared before `review:prepare` wrote
        // risk plans records no such generated file, so it publishes exactly as before.
        if (readBundleGeneratedSet(input.bundle)?.has(REVIEW_RISK_PLAN_NAME) === true) {
            fail(`missing review risk plan at ${planPath}; the bundle manifest records generating it`);
        }
        logIgnoredCallerDocuments(input.bundle, undefined, input.port);
        return;
    }
    const plan = parseReviewRiskPlan(planRead.value);
    assertReviewRiskPlanBindsBundle(input.number, input.head, plan, input.bundle);
    assertReviewEvidenceClaimsSafe(input.document);
    const dossierRead = readBundleFile(input.port, join(input.bundle, REVIEW_DOSSIER_NAME));
    logIgnoredCallerDocuments(input.bundle, dossierRead, input.port);
    const publication = buildReviewDossier({
        plan,
        persisted: dossierRead.present ? dossierRead.value : undefined,
        draws: input.document.draws,
        evidence: input.document.evidence?.claims ?? [],
        comments: input.document.comments,
        recommendation: input.document.event === 'APPROVE' ? 'approve' : 'request-changes',
    });
    if (publishedReviewId(publication.dossier) === undefined && input.recovered !== true) {
        assertReviewDrawFloor(plan, completedStances(publication.dossier));
    }
    persistCanonicalReviewDossier(publication, input.bundle, input.port);
}

/**
 * The dossier's recorded publication for this head, replayed (#3375, spec #3367 AC-004): when the
 * persisted record already binds a review id, the exact same review must stand live — same actor,
 * head, state, body, and comments — and every accepted finding must carry its public comment
 * binding. The run then reports that id instead of posting a duplicate. A recorded publication that
 * no longer stands, or stands differently, is corrupt evidence and fails closed before any write.
 * Returns undefined while the bundle records no publication: a legacy bundle (no risk plan) or a
 * dossier whose POST has not completed. Only recovery passes `recoveryLiveHead`, which lets a
 * reviewer approval that a later push dismissed stand as the recorded publication (#5046).
 */
export function recordedPublicationReplay(
    number: number,
    head: string,
    document: ReviewDocument,
    actorNodeId: string,
    port: PublishReviewPort,
    recoveryLiveHead?: string
): number | undefined {
    const bundle = reviewBundlePath(port.primaryRoot(), number, head);
    if (readBundleFile(port, join(bundle, REVIEW_RISK_PLAN_NAME)).present !== true) {
        // A manifest that records the plan while the file is absent is a refusal, exactly as at
        // dossier assembly; a bundle with neither is the legacy path and records no publication.
        if (readBundleGeneratedSet(bundle)?.has(REVIEW_RISK_PLAN_NAME) === true) {
            fail(
                `missing review risk plan at ${join(bundle, REVIEW_RISK_PLAN_NAME)}; the bundle manifest records generating it`
            );
        }
        return undefined;
    }
    const dossierPath = join(bundle, REVIEW_DOSSIER_NAME);
    const dossierRead = readBundleFile(port, dossierPath);
    if (!dossierRead.present) {
        return undefined;
    }
    const dossier = parseReviewDossier(dossierRead.value);
    const recorded = publishedReviewId(dossier);
    if (recorded === undefined) {
        return undefined;
    }
    if (port.remoteReview === undefined) {
        fail(`review publication ${recorded} is recorded but the port has no review inspector to replay it`);
    }
    const rendered = { ...document, body: renderReviewDocumentBody(document) };
    const remote = port.remoteReview(number, recorded);
    if (remote === undefined || !recordedReviewStands(remote, rendered, head, actorNodeId, recoveryLiveHead)) {
        fail(
            `recorded review publication ${recorded} does not stand live and exact for head ${head}; refusing to post a duplicate`
        );
    }
    const bound = new Set(publishedFindings(dossier).map((finding) => finding.findingId));
    const unbound = acceptedFindings(dossier).filter((finding) => !bound.has(finding.findingId));
    if (unbound.length > 0) {
        fail(
            `recorded review publication ${recorded} lacks public comment bindings for: ${unbound
                .map((finding) => finding.findingId)
                .join(', ')}`
        );
    }
    return recorded;
}

function assertCompleteReviewerIdentityForBinding(state: ReviewState, reviewId: number): void {
    if (
        state.latestReviewerCommitOid === null ||
        state.latestReviewerCommitOid === undefined ||
        (state.latestReviewerStateOnHead === 'APPROVED' && state.latestReviewerReviewDatabaseId === null)
    ) {
        fail(`review ${reviewId} has incomplete reviewer approval identity; retry when the live state is complete`);
    }
}

/**
 * Appends the landed publication's public ids to the head's dossier (#3375, spec #3367 AC-004):
 * one `review-published` and one `finding-published` per posted comment, matched to the review
 * document positionally after a path/line/side correspondence check. An APPROVE for a plan-carrying
 * bundle then appends one `delivery-authorized` event in the same write, binding the just-posted
 * reviewer review to the dossier digest when that review remains the latest independent approval
 * on the head and no review threads remain unresolved — the reviewer publication is the delivery
 * authorization (#4584). The record was persisted before the POST; this binding is the record's
 * only post-write step, and it re-validates the whole chain before persisting. Legacy bundles carry
 * no dossier and bind nothing.
 */
export function recordPublicationBindings(
    number: number,
    head: string,
    document: ReviewDocument,
    reviewId: number,
    port: PublishReviewPort,
    authorizeDelivery = true
): void {
    const bundle = reviewBundlePath(port.primaryRoot(), number, head);
    if (readBundleFile(port, join(bundle, REVIEW_RISK_PLAN_NAME)).present !== true) {
        if (readBundleGeneratedSet(bundle)?.has(REVIEW_RISK_PLAN_NAME) === true) {
            fail(
                `missing review risk plan at ${join(bundle, REVIEW_RISK_PLAN_NAME)}; the bundle manifest records generating it`
            );
        }
        return;
    }
    const dossierPath = join(bundle, REVIEW_DOSSIER_NAME);
    const dossierRead = readBundleFile(port, dossierPath);
    if (!dossierRead.present) {
        fail(`missing review dossier at ${dossierPath} after review ${reviewId} posted`);
    }
    const dossier = parseReviewDossier(dossierRead.value);
    if (publishedReviewId(dossier) !== undefined) {
        fail(
            `review dossier already binds publication ${publishedReviewId(dossier)}; refusing to rebind to ${reviewId}`
        );
    }
    if (port.reviewComments === undefined) {
        fail(`review ${reviewId} posted but the port has no review-comment reader to bind its public ids`);
    }
    const posted = port.reviewComments(number, reviewId);
    if (posted.length !== document.comments.length) {
        fail(
            `review ${reviewId} carries ${posted.length} public comments, not the document's ${document.comments.length}`
        );
    }
    const bindings = posted.map((comment, index) => {
        const expected = document.comments[index];
        if (
            expected === undefined ||
            comment.path !== expected.path ||
            comment.line !== expected.line ||
            comment.side !== expected.side
        ) {
            fail(
                `review ${reviewId} comment ${index} (${comment.path}:${comment.line}:${comment.side}) does not match the document`
            );
        }
        return { kind: 'finding-published' as const, findingId: `comment-${index}`, reviewId, commentId: comment.id };
    });
    let bound = appendReviewDossierEvents(dossier, [{ kind: 'review-published', reviewId }, ...bindings]);
    if (document.event === 'APPROVE' && authorizeDelivery) {
        if (port.reviewState === undefined) {
            fail(
                `review ${reviewId} approved a plan-carrying bundle but the port has no review-state reader to bind its delivery authorization`
            );
        }
        const state = port.reviewState(number, head);
        assertCompleteReviewerIdentityForBinding(state, reviewId);
        const currentPullRequest = port.pullRequest(number);
        if (
            currentPullRequest.state === 'OPEN' &&
            currentPullRequest.head === head &&
            state.latestReviewerStateOnHead === 'APPROVED' &&
            state.latestReviewerReviewDatabaseId === reviewId &&
            state.unresolvedThreads === 0
        ) {
            bound = appendReviewDossierEvents(bound, [
                {
                    kind: 'delivery-authorized',
                    reviewId,
                    approvalReviewId: reviewId,
                    unresolvedThreads: 0,
                    evidenceManifestDigest: authorizedEvidenceDigest(bound),
                    intent: 'deliver',
                },
            ]);
        }
    }
    if (port.writeBundleText === undefined) {
        fail(`review publication cannot write ${dossierPath}: the port has no bundle writer`);
    }
    port.writeBundleText(dossierPath, serializeReviewDossier(bound));
}

/**
 * Binds a publication that review:publish:recover found landed exactly after the posting run died
 * before binding it (#5008), so a later review:publish on the head replays it instead of posting a
 * duplicate. The events are the ones review:publish writes; the round freeze and the draw floor
 * bound only fresh posts, so neither re-runs for a review that already landed. A dossier already
 * binding this review is left unchanged.
 * An approval recovered after the pull request's head moved or merged binds no delivery
 * authorization. An open current approval binds authority only while it remains the latest
 * independent reviewer approval on that head with zero unresolved threads.
 * Every other step reads only the bundle and the review's own public record.
 */
export function recordRecoveredPublicationBindings(
    publication: {
        number: number;
        head: string;
        liveHead: string;
        state: string;
        reviewId: number;
        actorNodeId: string;
    },
    document: ReviewDocument,
    port: PublishReviewPort
): void {
    const { number, head, reviewId } = publication;
    const bundle = reviewBundlePath(port.primaryRoot(), number, head);
    const recorded = bundleRecordedPublicationId(bundle, port);
    if (recorded !== undefined && recorded !== reviewId) {
        fail(`review dossier binds publication ${recorded}, not the recovered landed review ${reviewId}`);
    }
    if (
        recordedPublicationReplay(number, head, document, publication.actorNodeId, port, publication.liveHead) !==
        undefined
    ) {
        return;
    }
    if (!hasRiskPlan(bundle, port)) {
        // A legacy bundle binds nothing; the binding itself refuses a plan its manifest records.
        recordPublicationBindings(number, head, document, reviewId, port);
        return;
    }
    prepareReviewDossierPublication({ number, head, bundle, document, port, recovered: true });
    recordPublicationBindings(
        number,
        head,
        document,
        reviewId,
        port,
        publication.state === 'OPEN' && publication.liveHead === head
    );
}

/**
 * Acceptance-time accounting gate (#3375, spec #3367 AC-004): the orchestrator may not accept a
 * head whose dossier records the review round incompletely. When the bundle carries a risk plan,
 * the dossier must exist, must name the landed publication, and must bind every accepted finding
 * to exactly one public comment; parsing the record re-validates its whole chain. A legacy bundle
 * prepared before dossiers existed carries neither file and is accepted exactly as before.
 */
export function assertAcceptanceDossierAccounting(number: number, head: string, port: PublishReviewPort): void {
    const bundle = reviewBundlePath(port.primaryRoot(), number, head);
    if (readBundleFile(port, join(bundle, REVIEW_RISK_PLAN_NAME)).present !== true) {
        if (readBundleGeneratedSet(bundle)?.has(REVIEW_RISK_PLAN_NAME) === true) {
            fail(
                `missing review risk plan at ${join(bundle, REVIEW_RISK_PLAN_NAME)}; the bundle manifest records generating it`
            );
        }
        return;
    }
    const dossierPath = join(bundle, REVIEW_DOSSIER_NAME);
    const dossierRead = readBundleFile(port, dossierPath);
    if (!dossierRead.present) {
        fail(`acceptance requires the head's review dossier at ${dossierPath}; the bundle carries a risk plan`);
    }
    const dossier = parseReviewDossier(dossierRead.value);
    const reviewId = publishedReviewId(dossier);
    if (reviewId === undefined) {
        fail(`acceptance requires the dossier to record its review publication; ${dossierPath} binds none`);
    }
    const bound = new Set(publishedFindings(dossier).map((finding) => finding.findingId));
    const unbound = acceptedFindings(dossier).filter((finding) => !bound.has(finding.findingId));
    if (unbound.length > 0) {
        fail(
            `acceptance requires every accepted finding to bind one public comment; unbound: ${unbound
                .map((finding) => finding.findingId)
                .join(', ')}`
        );
    }
}

/**
 * Whether the bundle carries its risk plan, failing when the manifest records generating one that
 * is absent. The three outcomes — plan present, legacy bundle, refusal — are the only ones every
 * gate in this module distinguishes.
 */
function bundleRiskPlanPresent(port: PublishReviewPort, bundle: string): boolean {
    const planPath = join(bundle, REVIEW_RISK_PLAN_NAME);
    if (readBundleFile(port, planPath).present) {
        return true;
    }
    if (readBundleGeneratedSet(bundle)?.has(REVIEW_RISK_PLAN_NAME) === true) {
        fail(`missing review risk plan at ${planPath}; the bundle manifest records generating it`);
    }
    return false;
}

function readBundleDossier(
    port: PublishReviewPort,
    bundle: string,
    label: string
): ReturnType<typeof parseReviewDossier> {
    const dossierPath = join(bundle, REVIEW_DOSSIER_NAME);
    const dossierRead = readBundleFile(port, dossierPath);
    if (!dossierRead.present) {
        fail(`${label} requires the head's review dossier at ${dossierPath}; the bundle carries a risk plan`);
    }
    return parseReviewDossier(dossierRead.value);
}

/**
 * Acceptance authorization gate (#3376, spec #3367 AC-005): a plan-carrying bundle's acceptance
 * must declare the authorization block, and every field must match the durable record and the
 * observed live state — the reviewer App's recorded publication id, the observed unresolved-thread
 * count, and the dossier's own evidence-manifest digest. A dossier already carrying the
 * authorization refuses a duplicate. A legacy bundle carries no evidence manifest to bind, so it
 * must not declare the block and is accepted exactly as before.
 */
export function assertAcceptanceAuthorization(
    number: number,
    head: string,
    authorization: DeliveryAuthorization | undefined,
    observedUnresolvedThreads: number,
    port: PublishReviewPort
): void {
    const bundle = reviewBundlePath(port.primaryRoot(), number, head);
    if (!bundleRiskPlanPresent(port, bundle)) {
        if (authorization !== undefined) {
            fail(`acceptance authorization cannot bind: the legacy bundle at ${bundle} carries no evidence manifest`);
        }
        return;
    }
    if (authorization === undefined) {
        fail(
            'acceptance of a plan-carrying bundle requires an authorization block: intent, approvalReviewId, unresolvedThreads, evidenceManifestDigest'
        );
    }
    const dossier = readBundleDossier(port, bundle, 'acceptance authorization');
    const approvalId = publishedReviewId(dossier);
    if (approvalId === undefined) {
        fail('acceptance authorization requires the dossier to record its review publication; it binds none');
    }
    if (authorization.approvalReviewId !== approvalId) {
        fail(
            `acceptance authorization approvalReviewId ${authorization.approvalReviewId} does not match the dossier's recorded publication ${approvalId}`
        );
    }
    if (authorization.unresolvedThreads !== observedUnresolvedThreads) {
        fail(
            `acceptance authorization unresolvedThreads ${authorization.unresolvedThreads} does not match the observed ${observedUnresolvedThreads}`
        );
    }
    if (authorization.evidenceManifestDigest !== dossier.dossierDigest) {
        fail(
            `acceptance authorization evidenceManifestDigest does not match the dossier's digest ${dossier.dossierDigest}`
        );
    }
    const existing = deliveryAuthorization(dossier);
    if (existing !== undefined) {
        fail(
            `review dossier already records delivery authorization ${existing.reviewId}; refusing a duplicate authorization`
        );
    }
}

/**
 * Appends the landed acceptance's delivery authorization to the head's dossier (#3376, spec #3367
 * AC-005), re-validating the whole chain before persisting — the same post-write binding pattern
 * as the reviewer publication. Legacy bundles carry no dossier and record nothing.
 */
export function recordAcceptanceAuthorization(
    number: number,
    head: string,
    authorization: DeliveryAuthorization | undefined,
    reviewId: number,
    port: PublishReviewPort
): void {
    const bundle = reviewBundlePath(port.primaryRoot(), number, head);
    if (!bundleRiskPlanPresent(port, bundle)) {
        return;
    }
    if (authorization === undefined) {
        fail(`acceptance ${reviewId} posted but carries no authorization block to record`);
    }
    const dossier = readBundleDossier(port, bundle, 'delivery authorization recording');
    const existing = deliveryAuthorization(dossier);
    if (existing !== undefined) {
        fail(
            `review dossier already records delivery authorization ${existing.reviewId}; refusing to rebind to ${reviewId}`
        );
    }
    const bound = appendReviewDossierEvents(dossier, [
        {
            kind: 'delivery-authorized',
            reviewId,
            approvalReviewId: authorization.approvalReviewId,
            evidenceManifestDigest: authorization.evidenceManifestDigest,
            unresolvedThreads: authorization.unresolvedThreads,
            intent: 'deliver',
        },
    ]);
    if (port.writeBundleText === undefined) {
        fail(`acceptance cannot write ${join(bundle, REVIEW_DOSSIER_NAME)}: the port has no bundle writer`);
    }
    port.writeBundleText(join(bundle, REVIEW_DOSSIER_NAME), serializeReviewDossier(bound));
}
