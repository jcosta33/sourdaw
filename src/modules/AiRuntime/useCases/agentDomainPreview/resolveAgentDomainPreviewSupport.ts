import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { getAppActionPreviewExecution } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import {
    type AgentDomainPreviewSupport,
    type AgentPreviewDomain,
    type AgentDomainPreviewUnsupportedReason,
} from '../../models/AgentDomainPreview';

import { resolveAgentPreviewDomains } from './resolveAgentPreviewDomains';

/**
 * Whether each domain the batch touches can produce a preview handle.
 *
 * Support is decided before any adapter runs, because the reason a domain
 * cannot be previewed is what the risk policy escalates on. An action whose
 * handler cannot execute inside the isolated projection makes its whole domain
 * unsupported: the projected post-state the handle would read never exists.
 */

function domainActions(actions: readonly AppAction[], domain: AgentPreviewDomain): readonly AppAction[] {
    return actions.filter((action) => resolveAgentPreviewDomains([action]).includes(domain));
}

function placesCachedAudioBuffer(action: AppAction): boolean {
    if (action.type !== 'addClip' || action.payload.type !== 'audio') {
        return false;
    }
    const { audioBufferId } = action.payload;
    if (audioBufferId === undefined) {
        return false;
    }
    return getCachedAudioBuffer({ bufferId: audioBufferId }) !== null;
}

function unsupportedReason(
    actions: readonly AppAction[],
    domain: AgentPreviewDomain
): AgentDomainPreviewUnsupportedReason | null {
    if (actions.some((action) => getAppActionPreviewExecution(action.type) !== 'isolated-project')) {
        return 'external-execution';
    }
    if (domain === 'audio-audition' && !actions.every(placesCachedAudioBuffer)) {
        return 'isolated-render-unavailable';
    }
    return null;
}

export function resolveAgentDomainPreviewSupport(actions: readonly AppAction[]): readonly AgentDomainPreviewSupport[] {
    return resolveAgentPreviewDomains(actions).map((domain) => {
        const reason = unsupportedReason(domainActions(actions, domain), domain);
        if (reason) {
            return { domain, status: 'unsupported', reason };
        }
        return { domain, status: 'supported' };
    });
}
