import { type AgentRenderProvenance } from '#/utils/agentRenderReceipt';

/** A stored render carries the same provenance its receipts echo, so the two cannot describe different renders. */
export type AgentSectionRenderArtifact = AgentRenderProvenance & {
    readonly owner: 'agent-section-render';
    readonly retention: 'session';
    readonly renderedAt: number;
    readonly durationSeconds: number;
    readonly frameCount: number;
    readonly channelCount: number;
    readonly byteSize: number;
    /** Digest of this artifact's geometry and samples, so equal audio is recognisably equal. */
    readonly contentAddress: string;
    readonly warnings: readonly string[];
    readonly buffer: AudioBuffer;
};
