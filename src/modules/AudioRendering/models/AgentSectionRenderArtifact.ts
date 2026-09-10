export type AgentSectionRenderArtifact = {
    readonly owner: 'agent-section-render';
    readonly retention: 'session';
    readonly jobId: string;
    readonly sectionId: string;
    readonly sectionName: string;
    readonly startBeat: number;
    readonly endBeat: number;
    readonly sampleRate: number;
    readonly tailSeconds: number;
    readonly sourceRevision: string;
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
