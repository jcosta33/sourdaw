import { getExecutableAppActionEffect } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { AGENT_PREVIEW_DOMAINS, type AgentPreviewDomain } from '../../models/AgentDomainPreview';

/**
 * Which preview domains a proposed batch touches.
 *
 * Membership is read from Command's per-operation effect declaration, traced
 * through each production handler, rather than restated here: an operation's
 * name carries no contract, and a second list of operations drifts out of the
 * first one silently. Each domain owns one effect dimension plus the effect
 * objects whose creation or removal is that domain's content:
 *
 * - `midi-overlay`: dimension `midi-content`, or `notes` created or removed.
 * - `audio-audition`: dimension `clip-audio`, or an `addClip` whose payload
 *   declares an audio clip — the one membership no dimension can express, since
 *   `addClip` places audio and MIDI through the same `arrangement` write.
 * - `automation-curve`: dimension `automation`, or an `automation-lane` or
 *   `automation-point` created or removed.
 * - `device-graph`: dimension `routing`, or a `track`, `bus`, `device`, `send`
 *   or `sidechain-route` created or removed. The `processing` dimension is
 *   deliberately absent: a parameter edit changes no topology.
 *
 * A `conditional` dimension does not count. It names a write that depends on
 * live execution-time state — a recording transport, a folder strip activation —
 * which an isolated preview never exercises, so the preview it would demand
 * shows nothing. The conditionals that do write content, such as the MIDI a
 * clip duplication copies, are already carried by the created and removed
 * objects.
 *
 * An operation Command declares no effect for is not executable, so no agent
 * batch can carry it, and it resolves no domain. The union is returned in
 * `AGENT_PREVIEW_DOMAINS` order.
 */

type ActionEffect = NonNullable<ReturnType<typeof getExecutableAppActionEffect>>;
type EffectDimension = ActionEffect['dimensions'][number];
type EffectObject = NonNullable<ActionEffect['creates']>[number];

const DOMAIN_RULES: Record<AgentPreviewDomain, { dimension: EffectDimension; objects: readonly EffectObject[] }> = {
    'midi-overlay': { dimension: 'midi-content', objects: ['notes'] },
    'audio-audition': { dimension: 'clip-audio', objects: [] },
    'automation-curve': { dimension: 'automation', objects: ['automation-lane', 'automation-point'] },
    'device-graph': { dimension: 'routing', objects: ['track', 'bus', 'device', 'send', 'sidechain-route'] },
};

function declaresDimension(effect: ActionEffect, dimension: EffectDimension): boolean {
    return effect.dimensions.includes(dimension);
}

function touchesObject(effect: ActionEffect, objects: readonly EffectObject[]): boolean {
    const created = effect.creates ?? [];
    const removed = effect.removes ?? [];
    return objects.some((object) => created.includes(object) || removed.includes(object));
}

function placesAudioClip(action: AppAction): boolean {
    return action.type === 'addClip' && action.payload.type === 'audio';
}

function touchesDomain(action: AppAction, domain: AgentPreviewDomain): boolean {
    if (domain === 'audio-audition' && placesAudioClip(action)) {
        return true;
    }
    const effect = getExecutableAppActionEffect(action.type);
    if (!effect) {
        return false;
    }
    const rule = DOMAIN_RULES[domain];
    return declaresDimension(effect, rule.dimension) || touchesObject(effect, rule.objects);
}

export function resolveAgentPreviewDomains(actions: readonly AppAction[]): readonly AgentPreviewDomain[] {
    return AGENT_PREVIEW_DOMAINS.filter((domain) => actions.some((action) => touchesDomain(action, domain)));
}
