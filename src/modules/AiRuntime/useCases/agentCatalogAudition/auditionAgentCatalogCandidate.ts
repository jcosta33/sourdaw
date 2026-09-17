import { analyzeAgentAuditionBuffer } from '#/modules/AudioAnalysis/useCases';
import { resolveAgentCatalogCandidate } from '#/modules/SampleLibrary/useCases';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

import { decodeCatalogCandidateFile } from './decodeCatalogCandidateFile';

/**
 * Hear one catalog candidate without touching the project.
 *
 * The decoded buffer stays local to this call: it is never handed to
 * `audioBufferCache`, so an audition leaves the engine's shared buffer identity
 * space exactly as it found it, and nothing an agent auditioned can be played,
 * frozen or exported by accident. What survives is a receipt — a content address
 * plus objective measurements — which is data, not audio, and can therefore
 * cross a saga step, a persisted run, or a user approval unchanged.
 */

const AGENT_AUDITION_SCHEMA_VERSION = 1;

type ResolvedCandidate = Extract<Awaited<ReturnType<typeof resolveAgentCatalogCandidate>>, { status: 'resolved' }>;

/** What the audition says about the candidate, apart from the audio itself. */
export type AgentAuditionReceipt = {
    readonly schemaVersion: typeof AGENT_AUDITION_SCHEMA_VERSION;
    readonly candidateId: string;
    readonly candidate: ResolvedCandidate['candidate'];
    readonly contentAddress: string;
    readonly analysis: ReturnType<typeof analyzeAgentAuditionBuffer>;
};

/** Refusals that belong to reaching the candidate's audio at all. */
export type AgentAuditionRejectionReason = 'unknown-catalog-id' | 'file-unavailable' | 'undecodable-audio';

type AuditionAgentCatalogCandidateInput = {
    readonly candidateId: string;
    /** An earlier receipt the new measurements are compared against. */
    readonly baseline?: AgentAuditionReceipt;
};

type AuditionAgentCatalogCandidateResult =
    | { readonly status: 'auditioned'; readonly receipt: AgentAuditionReceipt }
    | { readonly status: 'rejected'; readonly reason: AgentAuditionRejectionReason };

export async function auditionAgentCatalogCandidate({
    candidateId,
    baseline,
}: AuditionAgentCatalogCandidateInput): Promise<AuditionAgentCatalogCandidateResult> {
    const resolved = await resolveAgentCatalogCandidate({ candidateId });
    if (resolved.status === 'rejected') {
        return { status: 'rejected', reason: resolved.reason };
    }

    const buffer = await decodeCatalogCandidateFile(resolved.file);
    if (!buffer) {
        return { status: 'rejected', reason: 'undecodable-audio' };
    }

    const contentAddress = await getAudioBufferContentAddress(buffer);
    return {
        status: 'auditioned',
        receipt: {
            schemaVersion: AGENT_AUDITION_SCHEMA_VERSION,
            candidateId,
            candidate: resolved.candidate,
            contentAddress,
            analysis: analyzeAgentAuditionBuffer({
                buffer,
                subject: { contentAddress, candidateId },
                baseline: baseline?.analysis,
            }),
        },
    };
}
