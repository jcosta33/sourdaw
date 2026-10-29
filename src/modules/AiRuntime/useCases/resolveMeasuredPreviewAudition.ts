import { getAgentMeasurementArtifact } from '#/modules/AudioRendering/useCases';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { dbToGain } from '#/utils/audioLevelLaw';
import { digest } from '#/utils/canonicalDigest';

import { getPendingActionConfirmation } from '../stores/pendingActionConfirmationStore';

import { agentRunLifecycle } from './agentRunLifecycle';
import { digestCommandBatchContent } from './digestCommandBatchContent';
import { getAgentApprovalView } from './getAgentApprovalView';
import { metricGoalStateCodec } from './metricGoalStateCodec';

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    return keys.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => keys.includes(key));
}

function loudness(value: unknown): number | null {
    if (
        !record(value) ||
        !exactKeys(value, ['status', 'metricVersion', 'unit', 'value', 'confidence']) ||
        value.status !== 'measured' ||
        value.metricVersion !== 1 ||
        value.unit !== 'LUFS' ||
        (value.confidence !== 'exact' && value.confidence !== 'estimated') ||
        typeof value.value !== 'number' ||
        !Number.isFinite(value.value)
    ) {
        return null;
    }
    return value.value;
}

type RetainedArtifact = NonNullable<ReturnType<typeof getAgentMeasurementArtifact>>;

function renderAddress(value: unknown, route: string): { render: Record<string, unknown>; address: string } | null {
    if (
        !record(value) ||
        !exactKeys(value, ['route', 'artifact', 'sampleRate', 'frameCount', 'channelCount', 'durationSeconds']) ||
        value.route !== route ||
        !record(value.artifact) ||
        !exactKeys(value.artifact, ['contentAddress']) ||
        typeof value.artifact.contentAddress !== 'string' ||
        value.artifact.contentAddress.length === 0
    )
        return null;
    return { render: value, address: value.artifact.contentAddress };
}

function hasExactGeometry(value: Record<string, unknown>, artifact: RetainedArtifact): boolean {
    return (
        value.sampleRate === artifact.sampleRate &&
        value.frameCount === artifact.frameCount &&
        value.channelCount === artifact.channelCount &&
        value.durationSeconds === artifact.durationSeconds &&
        artifact.sampleRate === artifact.buffer.sampleRate &&
        artifact.frameCount === artifact.buffer.length &&
        artifact.channelCount === artifact.buffer.numberOfChannels &&
        artifact.durationSeconds === artifact.buffer.duration &&
        Number.isFinite(artifact.sampleRate) &&
        artifact.sampleRate > 0 &&
        Number.isSafeInteger(artifact.frameCount) &&
        artifact.frameCount >= 1 &&
        Number.isSafeInteger(artifact.channelCount) &&
        artifact.channelCount >= 1 &&
        Number.isFinite(artifact.durationSeconds) &&
        artifact.durationSeconds > 0
    );
}

function retained(value: unknown, route: string, revision: string) {
    const identity = renderAddress(value, route);
    if (identity === null) return null;
    const artifact = getAgentMeasurementArtifact(identity.address);
    if (artifact === null || artifact.sourceRevision !== revision || !hasExactGeometry(identity.render, artifact))
        return null;
    return artifact;
}

function sameRender(value: unknown, route: string, contentAddress: string): boolean {
    return (
        record(value) &&
        value.route === route &&
        record(value.artifact) &&
        value.artifact.contentAddress === contentAddress
    );
}

const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason });

type AuditionInput = { confirmationId: string; targetId: string; selectedIntentGroupIds?: readonly string[] };
type GoalState = NonNullable<ReturnType<typeof metricGoalStateCodec>>;
type Proof = GoalState['proofs'][number];
type Preview = Proof['preview'];
type Provenance = NonNullable<Preview['provenance']>;
type ProofContext = {
    confirmationId: string;
    runId: string;
    targetId: string;
    revision: string;
    hash: string;
    run: NonNullable<ReturnType<typeof agentRunLifecycle.get>>;
};

function bindingMatches(
    state: GoalState,
    envelope: Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope'],
    context: { revision: string; hash: string; runId: string; confirmationRevision: string }
): boolean {
    const binding = state.binding;
    return (
        binding !== null &&
        binding.revision === context.revision &&
        envelope.baseRevision === context.revision &&
        context.confirmationRevision === context.revision &&
        binding.contentHash === context.hash &&
        binding.runId === context.runId &&
        envelope.runId === context.runId &&
        binding.batchId === envelope.batchId &&
        binding.projectId === envelope.projectId
    );
}

function readCurrentProposal(input: AuditionInput) {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (confirmation === null || confirmation.status !== 'proposed' || confirmation.supersededBy !== null)
        return unavailable('This proposal is no longer awaiting approval.');
    const view = getAgentApprovalView({ confirmationId: input.confirmationId });
    if (view === null || view.freshness.status !== 'current')
        return unavailable('Measure the exact current proposal before auditioning it.');
    const groups = view.intentGroups.map((group) => group.id);
    const selected = input.selectedIntentGroupIds ?? groups;
    if (
        new Set(selected).size !== selected.length ||
        selected.length !== groups.length ||
        selected.some((id) => !groups.includes(id))
    )
        return unavailable('Re-preview the selected actions to obtain their exact measured audio.');
    const batch = confirmation.approvalSnapshot.commandBatch;
    const state = metricGoalStateCodec(confirmation.approvalSnapshot.metricGoalState);
    const run = agentRunLifecycle.get(confirmation.runId);
    if (
        batch === undefined ||
        state === null ||
        run === null ||
        ['completed', 'failed', 'cancelled', 'partially-completed'].includes(run.phase)
    )
        return unavailable('The proposal has no current admitted measurement pair.');
    const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
    if (parsed.status !== 'valid') return unavailable('The proposed command batch is unavailable.');
    const revision = captureProjectRevision();
    const hash = digestCommandBatchContent(parsed.envelope);
    if (
        !bindingMatches(state, parsed.envelope, {
            revision,
            hash,
            runId: confirmation.runId,
            confirmationRevision: confirmation.projectRevision,
        })
    )
        return unavailable('The measured proposal belongs to another project, revision or batch.');
    return {
        status: 'current' as const,
        state,
        context: {
            confirmationId: confirmation.id,
            runId: confirmation.runId,
            targetId: input.targetId,
            revision,
            hash,
            run,
        },
    };
}

function proofMatches(preview: Preview, provenance: Provenance, context: ProofContext): boolean {
    return (
        preview.revision === context.revision &&
        preview.batchContentHash === context.hash &&
        provenance.runId === context.runId &&
        provenance.callId.length > 0 &&
        preview.targets.length === provenance.targets.length &&
        new Set(preview.targets.map((target) => target.targetId)).size === preview.targets.length &&
        new Set(provenance.targets.map((target) => target.targetId)).size === provenance.targets.length
    );
}

function scopeMatches(preview: Preview, target: Preview['targets'][number], targetId: string): boolean {
    if (target.targetKind === 'master')
        return (
            targetId === 'master' && ['master', 'project'].includes(preview.scope.kind) && preview.targets.length === 1
        );
    const scope = preview.scope;
    return (
        scope.kind === (target.targetKind === 'track' ? 'tracks' : 'buses') &&
        'ids' in scope &&
        scope.ids.length === preview.targets.length &&
        preview.targets.every((entry) => scope.ids.includes(entry.targetId))
    );
}

function readProofTarget(proof: Proof, context: ProofContext) {
    const preview = proof.preview;
    const provenance = preview.provenance;
    if (provenance === undefined || !proofMatches(preview, provenance, context)) return null;
    const target = preview.targets.find((entry) => entry.targetId === context.targetId);
    const source = provenance.targets.find((entry) => entry.targetId === context.targetId);
    if (
        target === undefined ||
        source === undefined ||
        !record(target.audition) ||
        !exactKeys(target.audition, [
            'baseline',
            'preview',
            'baselineIntegratedLoudness',
            'previewIntegratedLoudness',
        ]) ||
        !scopeMatches(preview, target, context.targetId)
    )
        return null;
    return { target, source, provenance, audition: target.audition };
}

type Receipt = NonNullable<ProofContext['run']['plan']>['applicationToolReceipts'][number];

function receiptOriginMatches(receipt: Receipt, provenance: Provenance): boolean {
    return (
        (provenance.origin !== 'planner' || (receipt.turn >= 1 && receipt.origin === undefined)) &&
        (provenance.origin !== 'approval-preview' ||
            (receipt.turn === 0 && receipt.origin === 'application-verification'))
    );
}

function readReceiptTarget(proof: Proof, provenance: Provenance, context: ProofContext) {
    const receipt = context.run.plan?.applicationToolReceipts?.find(
        (entry) => entry.callId === provenance.callId && digest(entry) === proof.receiptDigest
    );
    if (
        receipt === undefined ||
        receipt.status !== 'success' ||
        receipt.toolName !== 'analysis.measure' ||
        receipt.revision !== context.revision ||
        receipt.turn !== provenance.turn ||
        !receiptOriginMatches(receipt, provenance) ||
        !record(receipt.data) ||
        receipt.data.kind !== 'analysis-measurement' ||
        receipt.data.subject !== 'preview' ||
        !Array.isArray(receipt.data.targets)
    )
        return null;
    const targets: unknown[] = receipt.data.targets;
    const target = targets.find((entry) => record(entry) && entry.targetId === context.targetId);
    return record(target) ? target : null;
}

function matchedPair(input: {
    baseline: RetainedArtifact;
    proposed: RetainedArtifact;
    baselineLufs: number;
    proposedLufs: number;
    context: ProofContext;
    receiptDigest: string;
}) {
    const { baseline, proposed, baselineLufs, proposedLufs, context } = input;
    const matchLufs = Math.min(baselineLufs, proposedLufs);
    const baselineGain = dbToGain(matchLufs - baselineLufs);
    const proposedGain = dbToGain(matchLufs - proposedLufs);
    if (
        !Number.isFinite(baselineGain) ||
        !Number.isFinite(proposedGain) ||
        baselineGain < 0 ||
        baselineGain > 1 ||
        proposedGain < 0 ||
        proposedGain > 1
    )
        return null;
    return {
        status: 'available' as const,
        identity: digest({
            confirmationId: context.confirmationId,
            targetId: context.targetId,
            hash: context.hash,
            revision: context.revision,
            receipt: input.receiptDigest,
            baseline: baseline.contentAddress,
            proposed: proposed.contentAddress,
            baselineLufs,
            proposedLufs,
        }),
        revision: context.revision,
        targetId: context.targetId,
        baseline: { buffer: baseline.buffer, gain: baselineGain, lufs: baselineLufs },
        preview: { buffer: proposed.buffer, gain: proposedGain, lufs: proposedLufs },
        matchLufs,
    };
}

function resolveProof(proof: Proof, context: ProofContext) {
    const resolved = readProofTarget(proof, context);
    if (resolved === null) return null;
    const receiptTarget = readReceiptTarget(proof, resolved.provenance, context);
    if (receiptTarget === null) return null;
    const { target, source, audition } = resolved;
    const route = target.targetKind === 'master' ? 'mixdown' : 'isolated-subgraph';
    const baseline = retained(audition.baseline, route, context.revision);
    const proposed = retained(audition.preview, route, context.revision);
    const baselineLufs = loudness(audition.baselineIntegratedLoudness);
    const proposedLufs = loudness(audition.previewIntegratedLoudness);
    if (
        baseline === null ||
        proposed === null ||
        baselineLufs === null ||
        proposedLufs === null ||
        !sameRender(source.baseline, route, baseline.contentAddress) ||
        !sameRender(source.preview, route, proposed.contentAddress) ||
        !sameRender(receiptTarget.baselineRender, route, baseline.contentAddress) ||
        !sameRender(receiptTarget.previewRender, route, proposed.contentAddress)
    )
        return null;
    return matchedPair({ baseline, proposed, baselineLufs, proposedLufs, context, receiptDigest: proof.receiptDigest });
}

/** Resolve only canonical receipt-backed resources; caller figures and addresses are never inputs. */
export function resolveMeasuredPreviewAudition(input: AuditionInput) {
    const proposal = readCurrentProposal(input);
    if (proposal.status === 'unavailable') return proposal;
    for (const proof of [...proposal.state.proofs].reverse()) {
        const pair = resolveProof(proof, proposal.context);
        if (pair !== null) return pair;
    }
    return unavailable('The exact retained audio pair or finite loudness match is unavailable.');
}
