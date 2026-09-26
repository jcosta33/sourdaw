export const AGENT_MEASUREMENT_RETENTION_POLICY = {
    maxArtifacts: 16,
    maxPcmBytes: 256 * 1024 * 1024,
    maxAgeMs: 4 * 60 * 60 * 1000,
} as const;
