import { type AgentReferenceCapability } from './isAgentReferenceCapabilityCandidate';

/**
 * The two capability families whose reference candidates are drawn from a single project collection:
 * the track list and the clips hanging off it. Reference resolution and creative admission both have
 * to say which family a target rule belongs to, and a second table would let the two disagree about
 * what a capability names.
 */
export type AgentReferenceCapabilityKind = 'track' | 'clip' | 'other';

const TRACK_REFERENCE_CAPABILITIES: readonly AgentReferenceCapability[] = [
    'track',
    'armable-track',
    'duplicable-track',
    'removable-track',
    'routable-source',
    'bus',
    'output',
    'device-host-track',
    'vca-member-track',
];

const CLIP_REFERENCE_CAPABILITIES: readonly AgentReferenceCapability[] = [
    'clip',
    'editable-clip',
    'editable-audio-clip',
    'editable-midi-clip',
    'writable-midi-clip',
];

export function getAgentReferenceCapabilityKind(capability: string): AgentReferenceCapabilityKind {
    if (TRACK_REFERENCE_CAPABILITIES.some((candidate) => candidate === capability)) {
        return 'track';
    }
    if (CLIP_REFERENCE_CAPABILITIES.some((candidate) => candidate === capability)) {
        return 'clip';
    }
    return 'other';
}
