import { analyzeAgentAuditionBuffer } from '#/modules/AudioAnalysis/useCases';
import { decodeAudioFileBuffer } from '#/modules/AudioEngine/useCases';
import { resolveAgentCatalogCandidate } from '#/modules/SampleLibrary/useCases';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

/**
 * Hear one catalog candidate without touching the project.
 *
 * The decoded buffer stays local to this call: it is never handed to
 * `audioBufferCache`, so an audition leaves the engine's shared buffer identity
 * space exactly as it found it, and nothing an agent auditioned can be played,
 * frozen or exported by accident. What survives is a render — a content address
 * plus objective measurements — which is data, not audio, and can therefore
 * cross a saga step, a persisted run, or a user approval unchanged.
 */

export const AGENT_AUDITION_SCHEMA_VERSION = 1;

type ResolvedCandidate = Extract<Awaited<ReturnType<typeof resolveAgentCatalogCandidate>>, { status: 'resolved' }>;

/** What the audition says about the candidate, apart from the audio itself. */
export type AgentAuditionRender = {
    readonly schemaVersion: typeof AGENT_AUDITION_SCHEMA_VERSION;
    readonly candidateId: string;
    readonly candidate: ResolvedCandidate['candidate'];
    readonly contentAddress: string;
    readonly analysis: ReturnType<typeof analyzeAgentAuditionBuffer>;
};

export type AgentAuditionRejectionReason = 'unknown-catalog-id' | 'file-unavailable' | 'undecodable-audio';

type AuditionAgentCatalogCandidateInput = {
    readonly candidateId: string;
    /** An earlier render the new measurements are compared against. */
    readonly baseline?: AgentAuditionRender;
};

type AuditionAgentCatalogCandidateResult =
    | { readonly status: 'auditioned'; readonly render: AgentAuditionRender }
    | { readonly status: 'rejected'; readonly reason: AgentAuditionRejectionReason };

async function decodeAuditionBuffer(file: File): Promise<AudioBuffer | null> {
    try {
        return await decodeAudioFileBuffer(file);
    } catch {
        return null;
    }
}

export async function auditionAgentCatalogCandidate({
    candidateId,
    baseline,
}: AuditionAgentCatalogCandidateInput): Promise<AuditionAgentCatalogCandidateResult> {
    const resolved = await resolveAgentCatalogCandidate({ candidateId });
    if (resolved.status === 'rejected') {
        return { status: 'rejected', reason: resolved.reason };
    }

    const buffer = await decodeAuditionBuffer(resolved.file);
    if (!buffer) {
        return { status: 'rejected', reason: 'undecodable-audio' };
    }

    const contentAddress = await getAudioBufferContentAddress(buffer);
    return {
        status: 'auditioned',
        render: {
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
