/**
 * Bundle-side dossier work for review publication (#3375, spec #3367 AC-004): assembling the
 * canonical dossier before the POST, replaying an already-recorded publication instead of
 * re-posting, and binding the landed review's public ids into the record after the POST.
 *
 * Split out of publishReview.ts to keep that module under the script-file line ceiling; the
 * publication flow itself stays there.
 */

import { join } from 'node:path';

import { assertPublicationSafeEvidence } from './evidenceSafety.ts';
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
    type ReviewDossierEvent,
} from './reviewDossier.ts';
import { serializeReviewDossier } from './reviewDossierChain.ts';
import { buildReviewDossier, recordedReviewStances } from './reviewDossierPublication.ts';
import { acceptedFindings, deliveryAuthorization, publishedFindings, publishedReviewId } from './reviewDossierViews.ts';
import { exactPublishedReview } from './reviewPublicationRemoteInspection.ts';
import { parseReviewRiskPlan, type ReviewRiskPlan } from './reviewRiskPolicy.ts';
import {
    REASSESSMENT_FILE_NAME,
    REVIEW_ROUND_ESCALATION_THRESHOLD,
    countReviewerRequestChangesRounds,
    gateReviewRoundEscalation,
    type ReviewReassessment,
} from './reviewRoundEscalation.ts';

import type { PublishReviewPort } from './publishReview.ts';
import type { DeliveryAuthorization, ReviewDocument } from './reviewDocumentParser.ts';

const REVIEW_RISK_PLAN_NAME = 'risk-plan.json';
const REVIEW_STANCES_NAME = 'stances.json';
const REVIEW_DOSSIER_NAME = 'dossier.json';
const REVIEW_DISCARDED_NAME = 'discarded.json';

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

/**
 * Approval claims are published evidence too, so they carry the same publication-safe shapes the
 * durable dossier enforces. The bounded review body and inline comments are deliberately excluded:
 * both are publication-fixed shapes with their own limits.
 */
function assertReviewEvidenceClaimsSafe(document: ReviewDocument): void {
    for (const [index, claim] of (document.evidence?.claims ?? []).entries()) {
        assertPublicationSafeEvidence(`review evidence claim[${index}].observable`, [claim.observable]);
        assertPublicationSafeEvidence(`review evidence claim[${index}].verification`, [claim.verification]);
        assertPublicationSafeEvidence(`review evidence claim[${index}].observed`, [claim.observed]);
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
 * The bundle base the escalation reassessment must bind, read from the bundle manifest. A
 * post-threshold head whose manifest supplies no usable context refuses with the escalation contract
 * message — naming the observed count, the threshold, the manifest the reader rejected, the fields
 * it demands, the repair, and the reassessment route — rather than a raw manifest read error. The
 * bundle reader reports an absent, unreadable, malformed, and invalid manifest as one failure
 * without naming the field at fault, so the message describes what the reader enforces and the
 * repair, instead of blaming baseSha for a manifest that is present and readable but wrong elsewhere.
 */
function readEscalationBaseSha(bundle: string, observedCount: number): string {
    try {
        return readReviewBundleContext(bundle).baseSha;
    } catch {
        return fail(
            `review round escalation: observed ${observedCount} reviewer request-changes rounds, at or above the threshold ${REVIEW_ROUND_ESCALATION_THRESHOLD}, but the bundle manifest at ${join(bundle, 'manifest.json')} does not supply a usable review bundle context — it is missing, unreadable, or does not carry a valid pr, baseRefName, baseSha, and headSha; repair or regenerate the manifest so the reassessment at ${join(bundle, REASSESSMENT_FILE_NAME)} can bind`
        );
    }
}

/**
 * Counts the reviewer REQUEST_CHANGES rounds in the pull request's public history and runs the
 * escalation gate (#4584), returning the consumed reassessment when the threshold is met and the
 * caller authored one, or `undefined` below the threshold. Reads only public channels and fails
 * closed when the port cannot read them. The base the reassessment must bind is read from the
 * bundle manifest, so the gate runs for legacy (plan-less) bundles exactly as for plan-carrying
 * ones.
 */
function readReviewRoundEscalation(
    number: number,
    head: string,
    bundle: string,
    port: PublishReviewPort
): ReviewReassessment | undefined {
    if (port.publicReviews === undefined || port.publicReviewComments === undefined) {
        fail('review round escalation requires the port to read the pull request public reviews and comments');
    }
    const reconstruction = reconstructReviewRounds(
        number,
        { state: 'OPEN', head },
        port.publicReviews(number),
        port.publicReviewComments(number)
    );
    const observedCount = countReviewerRequestChangesRounds(reconstruction);
    if (observedCount < REVIEW_ROUND_ESCALATION_THRESHOLD) {
        return undefined;
    }
    const baseSha = readEscalationBaseSha(bundle, observedCount);
    return gateReviewRoundEscalation({
        observedCount,
        pr: number,
        headSha: head,
        baseSha,
        bundle,
        reassessment: readBundleFile(port, join(bundle, REASSESSMENT_FILE_NAME)),
    });
}

/**
 * Whether a plan-carrying bundle's dossier already records its publication. Such a head replays that
 * record instead of posting fresh, so the escalation gate — which bounds fresh publications against
 * the live round count — must be skipped there. A caller input dossier (`dossier-input-v1`), or a
 * persisted record whose POST never landed its binding, records no publication and answers false.
 * Only called once the risk plan is known present, so a legacy bundle never reads its dossier here.
 */
function bundleRecordsPublication(bundle: string, port: PublishReviewPort): boolean {
    const dossierRead = readBundleFile(port, join(bundle, REVIEW_DOSSIER_NAME));
    if (!dossierRead.present) {
        return false;
    }
    const value = dossierRead.value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    if ((value as { format?: unknown }).format !== REVIEW_DOSSIER_FORMAT) {
        return false;
    }
    return publishedReviewId(parseReviewDossier(value)) !== undefined;
}

/**
 * Fresh reviewer publications carry the head-bound dossier beside the review document. The
 * orchestrator's acceptance document is not a review stance record, so it never reaches here.
 * Returns the consumed escalation reassessment when the round threshold required one, so the
 * publication binding can record it in the same write as the delivery authorization.
 */
export function prepareReviewDossierPublication(input: {
    number: number;
    head: string;
    bundle: string;
    document: ReviewDocument;
    port: PublishReviewPort;
}): ReviewReassessment | undefined {
    const planPath = join(input.bundle, REVIEW_RISK_PLAN_NAME);
    const planRead = readBundleFile(input.port, planPath);
    if (planRead.present) {
        // A head whose dossier already records its publication replays that record instead of
        // posting a fresh review, so the escalation gate is skipped: the live round count advanced
        // by exactly the replayed review, and the reassessment the caller wrote names the pre-post
        // count. Re-publishing mints no second review-reassessed event.
        if (bundleRecordsPublication(input.bundle, input.port)) {
            return undefined;
        }
    } else if (readBundleGeneratedSet(input.bundle)?.has(REVIEW_RISK_PLAN_NAME) === true) {
        fail(`missing review risk plan at ${planPath}; the bundle manifest records generating it`);
    }
    // The gate bounds every fresh reviewer publication, plan-carrying and legacy alike; only the
    // recording of the review-reassessed event stays conditional on a dossier being present.
    const reassessment = readReviewRoundEscalation(input.number, input.head, input.bundle, input.port);
    if (!planRead.present) {
        // Legacy compatibility: a bundle whose manifest was prepared before `review:prepare` wrote
        // risk plans records no such generated file, so it publishes exactly as before instead of
        // being refused for a record it was never prepared with.
        return undefined;
    }
    const plan = parseReviewRiskPlan(planRead.value);
    assertReviewRiskPlanBindsBundle(input.number, input.head, plan, input.bundle);
    const dossierRead = readBundleFile(input.port, join(input.bundle, REVIEW_DOSSIER_NAME));
    if (!dossierRead.present) {
        fail(
            `missing review dossier at ${join(input.bundle, REVIEW_DOSSIER_NAME)}; write the caller's ${REVIEW_DOSSIER_NAME} beside review.json for head ${input.head}`
        );
    }
    assertReviewEvidenceClaimsSafe(input.document);
    const discardedRead = readBundleFile(input.port, join(input.bundle, REVIEW_DISCARDED_NAME));
    // The caller's pre-dispatch stance record is the only stance gate: when it is present the
    // dossier must correspond to it one-to-one, and when it is absent the publication carries no
    // stance-completeness constraint. The plan's mechanically derived list is never enforced.
    const stancesPath = join(input.bundle, REVIEW_STANCES_NAME);
    const recordedStances = recordedReviewStances(readBundleFile(input.port, stancesPath), stancesPath);
    const publication = buildReviewDossier({
        plan,
        raw: dossierRead.value,
        discarded: discardedRead.present ? discardedRead.value : undefined,
        comments: input.document.comments,
        recommendation: input.document.event === 'APPROVE' ? 'approve' : 'request-changes',
        recordedStances,
    });
    persistCanonicalReviewDossier(publication, input.bundle, input.port);
    return reassessment;
}

/**
 * The dossier's recorded publication for this head, replayed (#3375, spec #3367 AC-004): when the
 * persisted record already binds a review id, the exact same review must stand live — same actor,
 * head, state, body, and comments — and every accepted finding must carry its public comment
 * binding. The run then reports that id instead of posting a duplicate. A recorded publication that
 * no longer stands, or stands differently, is corrupt evidence and fails closed before any write.
 * Returns undefined while the bundle records no publication: a legacy bundle (no risk plan) or a
 * dossier whose POST has not completed.
 */
export function recordedPublicationReplay(
    number: number,
    head: string,
    document: ReviewDocument,
    actorNodeId: string,
    port: PublishReviewPort
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
    if (remote === undefined || !exactPublishedReview(remote, rendered, head, actorNodeId)) {
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

/**
 * Appends the landed publication's public ids to the head's dossier (#3375, spec #3367 AC-004):
 * one `review-published` and one `finding-published` per posted comment, matched to the review
 * document positionally after a path/line/side correspondence check. An APPROVE for a plan-carrying
 * bundle then appends one `delivery-authorized` event in the same write, binding the just-posted
 * reviewer review to the dossier digest and the unresolved-thread count observed at publication —
 * the reviewer publication is the delivery authorization (#4584). When the escalation gate consumed
 * a reassessment, one `review-reassessed` event records its observed count, threshold, action and
 * reason in that same write. The record was persisted before the POST; this binding is the record's
 * only post-write step, and it re-validates the whole chain before persisting. Legacy bundles carry
 * no dossier and bind nothing.
 */
export function recordPublicationBindings(
    number: number,
    head: string,
    document: ReviewDocument,
    reviewId: number,
    port: PublishReviewPort,
    reviewReassessment?: ReviewReassessment
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
    const postPublication: ReviewDossierEvent[] = [];
    if (document.event === 'APPROVE') {
        if (port.reviewState === undefined) {
            fail(
                `review ${reviewId} approved a plan-carrying bundle but the port has no review-state reader to bind its delivery authorization`
            );
        }
        const state = port.reviewState(number, head);
        postPublication.push({
            kind: 'delivery-authorized',
            reviewId,
            approvalReviewId: reviewId,
            unresolvedThreads: state.unresolvedThreads,
            evidenceManifestDigest: authorizedEvidenceDigest(bound),
            intent: 'deliver',
        });
    }
    if (reviewReassessment !== undefined) {
        postPublication.push({
            kind: 'review-reassessed',
            roundsObserved: reviewReassessment.roundsObserved,
            threshold: REVIEW_ROUND_ESCALATION_THRESHOLD,
            action: reviewReassessment.action,
            reason: reviewReassessment.reason,
        });
    }
    if (postPublication.length > 0) {
        bound = appendReviewDossierEvents(bound, postPublication);
    }
    if (port.writeBundleText === undefined) {
        fail(`review publication cannot write ${dossierPath}: the port has no bundle writer`);
    }
    port.writeBundleText(dossierPath, serializeReviewDossier(bound));
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
