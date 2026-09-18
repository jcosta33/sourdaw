import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import { type AppAction } from '#/utils/handlerContract';

import {
    AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION,
    type AgentAudioAuditionClip,
    type AgentDomainPreviewInput,
    type AgentDomainPreviewResult,
} from '../../models/AgentDomainPreview';

import { resolveAgentPreviewDomains } from './resolveAgentPreviewDomains';

/**
 * The figures of the cached buffers an audio batch would place.
 *
 * An audition is bounded to what is already decoded: the handle carries each
 * buffer's duration, sample rate and channel count, never its samples and never
 * a render. Any other way of changing clip audio has no audition, because
 * producing one would mean rendering inside a preview.
 */

function auditionedBuffers(actions: readonly AppAction[]): readonly AgentAudioAuditionClip[] | null {
    const audited: AgentAudioAuditionClip[] = [];
    for (const action of actions) {
        if (!resolveAgentPreviewDomains([action]).includes('audio-audition')) {
            continue;
        }
        if (action.type !== 'addClip' || action.payload.audioBufferId === undefined) {
            return null;
        }
        const { audioBufferId } = action.payload;
        const buffer = getCachedAudioBuffer({ bufferId: audioBufferId });
        if (!buffer) {
            return null;
        }
        audited.push({
            audioBufferId,
            durationSeconds: buffer.duration,
            sampleRate: buffer.sampleRate,
            channelCount: buffer.numberOfChannels,
        });
    }
    return audited;
}

export function previewAudioAudition(input: AgentDomainPreviewInput): AgentDomainPreviewResult {
    const audited = auditionedBuffers(input.actions);
    if (audited === null) {
        return { status: 'unsupported', domain: 'audio-audition', reason: 'isolated-render-unavailable' };
    }
    return {
        status: 'previewed',
        domain: 'audio-audition',
        schemaVersion: AGENT_DOMAIN_PREVIEW_SCHEMA_VERSION,
        handle: audited,
    };
}
