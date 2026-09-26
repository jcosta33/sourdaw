/** One scope render an agent measurement read, retained under the digest of its geometry and samples. */
export type AgentMeasurementArtifact = {
    readonly owner: 'agent-measurement';
    readonly retention: 'session';
    readonly contentAddress: string;
    /** The project revision the render was checked against before and after it ran. */
    readonly sourceRevision: string;
    readonly renderedAt: number;
    readonly sampleRate: number;
    readonly frameCount: number;
    readonly channelCount: number;
    readonly durationSeconds: number;
    readonly byteSize: number;
    readonly buffer: AudioBuffer;
};
