import { MAX_TRACK_NOTES_LENGTH } from '#/utils/trackNotesLimits';

import {
    existingTrackTargetRules,
    TRACK_MUTATION_IDENTITY,
    type ExecutableAppActionDescriptor,
    type ExecutableAppActionTargetRule,
} from './sharedDescriptorParts';

const existingDisableableTrackTargetRules = [
    { argument: 'trackId', capability: 'disableable-track', allowBatchLocal: false },
] as const satisfies readonly ExecutableAppActionTargetRule[];

/** Track state edits write one track's saved activation or notes; the track's clips and devices are untouched. */
export const trackStateDescriptors = [
    {
        actionType: 'disableTrack',
        risk: 'bounded-reversible',
        description:
            'Disable a track so it is silent, or enable it again; a disabled track keeps its clips and devices.',
        intentPhrases: [
            'disable track',
            'disable the track',
            'enable track',
            'enable the track',
            'deactivate track',
            'deactivate the track',
            'activate track',
            'activate the track',
        ],
        targetRules: existingDisableableTrackTargetRules,
        valueRules: [
            {
                argument: 'disabled',
                kind: 'boolean-intent',
                truePhrases: ['disable track', 'disable the track', 'deactivate track', 'deactivate the track'],
                falsePhrases: ['enable track', 'enable the track', 'activate track', 'activate the track'],
            },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing track ID' },
                disabled: { type: 'boolean', description: 'true=disable, false=enable' },
            },
            required: ['trackId', 'disabled'],
        },
    },
    {
        actionType: 'setTrackNotes',
        risk: 'bounded-reversible',
        description: `Replace a track's notes text, up to ${MAX_TRACK_NOTES_LENGTH} characters.`,
        intentPhrases: ['set track notes', 'set the track notes', 'set notes', 'set the notes'],
        targetRules: existingTrackTargetRules,
        valueRules: [{ argument: 'notes', kind: 'text-after-connector', connector: 'to' }],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing track ID' },
                notes: {
                    type: 'string',
                    maxLength: MAX_TRACK_NOTES_LENGTH,
                    description: `The new notes text, at most ${MAX_TRACK_NOTES_LENGTH} characters`,
                },
            },
            required: ['trackId', 'notes'],
        },
    },
] as const satisfies readonly ExecutableAppActionDescriptor[];

export const trackStateMutationIdentityRulesByType = {
    disableTrack: TRACK_MUTATION_IDENTITY,
    setTrackNotes: TRACK_MUTATION_IDENTITY,
} as const;

/** Whether applying the same command twice leaves the state one application leaves. */
export const trackStateMutationIdempotenceByType = {
    disableTrack: true,
    setTrackNotes: true,
} as const;
