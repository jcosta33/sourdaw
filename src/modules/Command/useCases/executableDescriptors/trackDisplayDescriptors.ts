import { MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '#/utils/trackHeightLimits';

import {
    existingTrackTargetRules,
    TRACK_MUTATION_IDENTITY,
    type ExecutableAppActionDescriptor,
    type ExecutableAppActionTargetRule,
} from './sharedDescriptorParts';

const existingHideableTrackTargetRules = [
    { argument: 'trackId', capability: 'hideable-track', allowBatchLocal: false },
] as const satisfies readonly ExecutableAppActionTargetRule[];

const existingFolderTargetRules = [
    { argument: 'trackId', capability: 'folder-track', allowBatchLocal: false },
] as const satisfies readonly ExecutableAppActionTargetRule[];

/** Track display edits change what the arrangement shows, never what plays. */
export const trackDisplayDescriptors = [
    {
        actionType: 'hideTrack',
        risk: 'bounded-reversible',
        description: "Hide a track's row from the arrangement and mixer, or show it again; a hidden track still plays.",
        intentPhrases: ['hide', 'unhide'],
        targetRules: existingHideableTrackTargetRules,
        valueRules: [
            {
                argument: 'hidden',
                kind: 'boolean-intent',
                truePhrases: ['hide'],
                falsePhrases: ['unhide'],
            },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing track ID' },
                hidden: { type: 'boolean', description: 'true=hide, false=show' },
            },
            required: ['trackId', 'hidden'],
        },
    },
    {
        actionType: 'foldTrack',
        risk: 'bounded-reversible',
        description: "Fold a folder track to hide its children's rows, or unfold it.",
        intentPhrases: [
            'fold folder',
            'fold the folder',
            'collapse folder',
            'collapse the folder',
            'unfold folder',
            'unfold the folder',
            'expand folder',
            'expand the folder',
        ],
        targetRules: existingFolderTargetRules,
        valueRules: [
            {
                argument: 'folded',
                kind: 'boolean-intent',
                truePhrases: ['fold folder', 'fold the folder', 'collapse folder', 'collapse the folder'],
                falsePhrases: ['unfold folder', 'unfold the folder', 'expand folder', 'expand the folder'],
            },
        ],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing folder track ID' },
                folded: { type: 'boolean', description: 'true=fold, false=unfold' },
            },
            required: ['trackId', 'folded'],
        },
    },
    {
        actionType: 'setTrackHeight',
        risk: 'bounded-reversible',
        description: `Set a track's row height in pixels, from ${MIN_TRACK_HEIGHT} to ${MAX_TRACK_HEIGHT}.`,
        intentPhrases: ['track height', 'row height', 'resize track'],
        targetRules: existingTrackTargetRules,
        valueRules: [{ argument: 'height', kind: 'number-if-present', requiredInPrompt: true }],
        parameters: {
            properties: {
                trackId: { type: 'string', description: 'Existing track ID' },
                height: {
                    type: 'number',
                    minimum: MIN_TRACK_HEIGHT,
                    maximum: MAX_TRACK_HEIGHT,
                    description: `Row height in pixels, ${MIN_TRACK_HEIGHT} to ${MAX_TRACK_HEIGHT}`,
                },
            },
            required: ['trackId', 'height'],
        },
    },
] as const satisfies readonly ExecutableAppActionDescriptor[];

export const trackDisplayMutationIdentityRulesByType = {
    hideTrack: TRACK_MUTATION_IDENTITY,
    foldTrack: TRACK_MUTATION_IDENTITY,
    setTrackHeight: TRACK_MUTATION_IDENTITY,
} as const;

/** Whether applying the same command twice leaves the state one application leaves. */
export const trackDisplayMutationIdempotenceByType = {
    hideTrack: true,
    foldTrack: true,
    setTrackHeight: true,
} as const;
