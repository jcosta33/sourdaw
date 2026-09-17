import {
    type AgentDomainPreviewInput,
    type AgentDomainPreviewResult,
    type AgentPreviewDomain,
} from '../../models/AgentDomainPreview';

import { previewAudioAudition } from './previewAudioAudition';
import { previewAutomationCurve } from './previewAutomationCurve';
import { previewDeviceGraph } from './previewDeviceGraph';
import { previewMidiOverlay } from './previewMidiOverlay';
import { resolveAgentDomainPreviewSupport } from './resolveAgentDomainPreviewSupport';

/**
 * One preview result per domain the batch touches, in domain declaration order.
 *
 * Support decides first: an unsupported domain returns its reason without
 * running an adapter, so an adapter never has to answer for a post-state that
 * was never produced.
 */

const previewAdapterByDomain: Record<AgentPreviewDomain, (input: AgentDomainPreviewInput) => AgentDomainPreviewResult> =
    {
        'midi-overlay': previewMidiOverlay,
        'audio-audition': previewAudioAudition,
        'automation-curve': previewAutomationCurve,
        'device-graph': previewDeviceGraph,
    };

export function buildAgentDomainPreviews(input: AgentDomainPreviewInput): readonly AgentDomainPreviewResult[] {
    return resolveAgentDomainPreviewSupport(input.actions).map((support) => {
        if (support.status === 'unsupported') {
            return { status: 'unsupported', domain: support.domain, reason: support.reason };
        }
        return previewAdapterByDomain[support.domain](input);
    });
}
