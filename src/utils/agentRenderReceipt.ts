/**
 * Neutral render-receipt contract for offline section renders. Lives in `src/utils/` so the
 * renderer, the handler contract and the run orchestration each depend on one shape rather than on
 * each other. A receipt is caller-scoped telemetry: it carries an owner-local copy of the caller's
 * work identity so a receipt that outlives its lease cannot be mistaken for live evidence, and it
 * content-addresses rendered audio so two renders of the same audio are recognisably the same.
 */

/** The caller's work identity at the moment a receipt was produced. */
export type AgentWorkOwnerIdentity = {
    readonly runId: string;
    readonly workId: string;
    readonly leaseId: string;
    readonly cancellationGeneration: number;
};

/** The eight fields that identify exactly which render produced an artifact. */
export type AgentRenderProvenance = {
    readonly jobId: string;
    readonly sectionId: string;
    readonly sectionName: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly sampleRate: number;
    readonly tailSeconds: number;
    readonly sourceRevision: string;
};

export type AgentRenderFailureKind = 'attachment-refused' | 'revision-mismatch' | 'invalid-buffer' | 'render-error';

export type AgentRenderReceipt =
    | {
          readonly phase: 'started';
          readonly owner: AgentWorkOwnerIdentity | null;
          readonly provenance: AgentRenderProvenance;
      }
    | {
          readonly phase: 'rendered';
          readonly owner: AgentWorkOwnerIdentity | null;
          readonly provenance: AgentRenderProvenance;
          readonly contentAddress: string;
          readonly frameCount: number;
          readonly channelCount: number;
          readonly renderedAt: number;
      }
    | {
          readonly phase: 'failed';
          readonly owner: AgentWorkOwnerIdentity | null;
          readonly provenance: AgentRenderProvenance;
          readonly failureKind: AgentRenderFailureKind;
      }
    | {
          readonly phase: 'cancelled';
          readonly owner: AgentWorkOwnerIdentity | null;
          readonly provenance: AgentRenderProvenance;
      }
    | {
          readonly phase: 'batch-settled';
          readonly owner: AgentWorkOwnerIdentity | null;
          readonly outcome: 'completed' | 'failed' | 'cancelled';
          readonly jobIds: readonly string[];
      };

export function cloneAgentWorkOwnerIdentity(owner: AgentWorkOwnerIdentity | null): AgentWorkOwnerIdentity | null {
    if (!owner) {
        return null;
    }
    return {
        runId: owner.runId,
        workId: owner.workId,
        leaseId: owner.leaseId,
        cancellationGeneration: owner.cancellationGeneration,
    };
}

const CONTENT_ADDRESS_HEADER_BYTE_SIZE = 3 * Uint32Array.BYTES_PER_ELEMENT;

/**
 * Content-addresses rendered audio over its geometry and every sample. The geometry header is part
 * of the digest because two renders can share samples while differing in rate, length or channel
 * count, and those are different audio. A section artifact runs to hundreds of megabytes at the
 * retention bound, so this reads the platform digest rather than a scripted one.
 */
export async function getAudioBufferContentAddress(buffer: AudioBuffer): Promise<string> {
    const frameCount = buffer.length;
    const channelCount = buffer.numberOfChannels;
    const channelByteSize = frameCount * Float32Array.BYTES_PER_ELEMENT;
    const bytes = new Uint8Array(CONTENT_ADDRESS_HEADER_BYTE_SIZE + channelCount * channelByteSize);
    const header = new DataView(bytes.buffer, 0, CONTENT_ADDRESS_HEADER_BYTE_SIZE);
    header.setUint32(0, buffer.sampleRate, true);
    header.setUint32(4, frameCount, true);
    header.setUint32(8, channelCount, true);
    for (let channel = 0; channel < channelCount; channel += 1) {
        const samples = buffer.getChannelData(channel);
        bytes.set(
            new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength),
            CONTENT_ADDRESS_HEADER_BYTE_SIZE + channel * channelByteSize
        );
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}
