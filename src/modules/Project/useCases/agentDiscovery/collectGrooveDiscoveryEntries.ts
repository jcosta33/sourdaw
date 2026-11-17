import { grooveTemplateStore } from '#/modules/MIDI/stores';

import { type DiscoveryCandidate } from '../../services/agentDiscovery/discoveryCandidates';

/**
 * The project's groove pool as the MIDI module holds it, built-in and project templates alike, so
 * a planner names a template that exists rather than inventing one. Null when no pool is loaded.
 */
export function collectGrooveDiscoveryEntries(): DiscoveryCandidate[] | null {
    const state = grooveTemplateStore.value;
    if (!state) {
        return null;
    }
    return state.templates.map((template): DiscoveryCandidate => ({
        // The pool publishes no kind vocabulary a caller may filter templates by.
        kind: null,
        entry: {
            id: template.id,
            name: template.name,
            domain: 'groove',
            availability: 'available',
            reason: null,
            version: String(template.schemaVersion),
            evidence: {
                source: 'groove-pool',
                subdivision: template.subdivision,
                provenance: template.provenance.type,
            },
        },
    }));
}
