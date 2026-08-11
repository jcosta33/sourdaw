export const AGENT_SECTION_RENDER_RETENTION_POLICY = {
    maxArtifacts: 16,
    maxPcmBytes: 512 * 1024 * 1024,
    maxAgeMs: 4 * 60 * 60 * 1000,
} as const;
