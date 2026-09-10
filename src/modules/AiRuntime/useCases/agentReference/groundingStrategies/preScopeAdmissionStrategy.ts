import { getExecutableAppActionGroundingCatalog } from '#/modules/Command/useCases';

import { type ProjectContext } from '../../../models/ProjectContext';

import {
    createGroundingAdmissionStrategyRegistry,
    type GroundingAdmissionResult,
    type GroundingAdmissionStrategyDefinition,
} from './createGroundingAdmissionStrategyRegistry';
import { hasRestrictedTrackControlScope } from './hasRestrictedTrackControlScope';
import { isExplicitClipLoopLengthPrompt } from './isExplicitClipLoopLengthPrompt';
import { normalizePromptText } from './normalizePromptText';

export const preScopeActionNames = ['muteTrack', 'soloTrack', 'stopPlayback', 'setClipLoopLength'] as const;

export type PreScopeActionName = (typeof preScopeActionNames)[number];

export type PreScopeAdmissionInput = {
    actionName: string;
    context: ProjectContext;
    prompt: string;
};

export type PreScopeAdmissionResult = GroundingAdmissionResult;

export type PreScopeAdmissionStrategyDefinition<Name extends PreScopeActionName> = GroundingAdmissionStrategyDefinition<
    Name,
    Omit<PreScopeAdmissionInput, 'actionName'>
>;

const preScopeAdmissionLabel = 'pre-scope admission';

function isExplicitStopPlaybackPrompt(prompt: string): boolean {
    let commandText = prompt.trim();
    commandText = commandText.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/iu, '');
    commandText = commandText.replace(/^please\s+/iu, '');
    const normalized = normalizePromptText(commandText);
    return [
        'stop playback',
        'stop the playback',
        'stop transport',
        'stop the transport',
        'halt playback',
        'halt the playback',
        'halt transport',
        'halt the transport',
    ].includes(normalized);
}

export const preScopeAdmissionStrategyDefinitions = [
    {
        name: 'muteTrack',
        transform: ({ context, prompt }) =>
            hasRestrictedTrackControlScope(prompt, context) ? 'Provider mute scope is not explicitly universal' : null,
    },
    {
        name: 'soloTrack',
        transform: ({ context, prompt }) =>
            hasRestrictedTrackControlScope(prompt, context) ? 'Provider solo scope is not explicitly universal' : null,
    },
    {
        name: 'stopPlayback',
        transform: ({ prompt }) =>
            isExplicitStopPlaybackPrompt(prompt)
                ? null
                : 'Provider action is not grounded in an explicit transport-stop request',
    },
    {
        name: 'setClipLoopLength',
        transform: ({ prompt }) =>
            isExplicitClipLoopLengthPrompt(prompt)
                ? null
                : 'Provider clip loop-length action requires one direct named or selected clip request in beats',
    },
] satisfies readonly PreScopeAdmissionStrategyDefinition<PreScopeActionName>[];

const preScopeAdmissionStrategyRegistry = createGroundingAdmissionStrategyRegistry<
    PreScopeActionName,
    Omit<PreScopeAdmissionInput, 'actionName'>
>(
    preScopeAdmissionLabel,
    preScopeAdmissionStrategyDefinitions,
    getExecutableAppActionGroundingCatalog(),
    preScopeActionNames
);

function isPreScopeActionName(actionName: string): actionName is PreScopeActionName {
    return preScopeActionNames.some((expectedActionName) => expectedActionName === actionName);
}

export function groundPreScopeAdmission(input: PreScopeAdmissionInput): PreScopeAdmissionResult {
    if (!isPreScopeActionName(input.actionName)) {
        return null;
    }
    const strategy = preScopeAdmissionStrategyRegistry.get(input.actionName);
    if (!strategy) {
        throw new Error(`Missing ${preScopeAdmissionLabel} strategy: ${input.actionName}`);
    }
    return strategy({ context: input.context, prompt: input.prompt });
}
