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
    readonly warnings: readonly string[];
    readonly buffer: AudioBuffer;
};
