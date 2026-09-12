/**
 * Capabilities the application deliberately does not have. They are reported so a provider reads
 * their absence as a stated contract instead of inferring it from a silent catalog, and they are
 * never callable: no execution route resolves these names.
 */
export const DEFERRED_AGENT_CAPABILITIES = [
    {
        name: 'agent.media.listen',
        kind: 'deferred-capability',
        callable: false,
        owner: 'AiRuntime',
        availability: 'deferred',
        reason: 'AC-044 defers agent media listening: no application tool accepts audio, and render, stem, reference and bounce audio stay blocked from remote transmission.',
    },
    {
        name: 'agent.media.generate',
        kind: 'deferred-capability',
        callable: false,
        owner: 'AiRuntime',
        availability: 'deferred',
        reason: 'AC-047 defers agent media generation: no application tool synthesizes media, and a run records neither the audio-upload nor the remote-generation grant as held.',
    },
    {
        name: 'agent.project.reconstruct',
        kind: 'deferred-capability',
        callable: false,
        owner: 'AiRuntime',
        availability: 'deferred',
        reason: 'AC-048 defers rebuilding a project from reference media: ordinary application-owned stem import remains the only route from audio files to a project.',
    },
] as const;
