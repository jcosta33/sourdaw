import { MAX_TRANSPORT_BARS, MIN_TRANSPORT_BARS } from '#/utils/transportBarsLimits';

import { SINGLETON_MUTATION_IDENTITY, type ExecutableAppActionDescriptor } from './sharedDescriptorParts';

/** Count-in and pre-roll are project transport settings: each command states the wanted value, never flips it. */
export const transportCountInDescriptors = [
    {
        actionType: 'toggleCountIn',
        risk: 'bounded-reversible',
        description: 'Turn the count-in on or off. Always states the wanted state; it never flips the current one.',
        intentPhrases: [
            'turn count-in on',
            'turn count-in off',
            'enable count-in',
            'disable count-in',
            'enable the count-in',
            'disable the count-in',
        ],
        targetRules: [],
        valueRules: [
            {
                argument: 'enabled',
                kind: 'boolean-intent',
                truePhrases: ['turn count-in on', 'enable count-in', 'enable the count-in'],
                falsePhrases: ['turn count-in off', 'disable count-in', 'disable the count-in'],
            },
        ],
        parameters: {
            properties: { enabled: { type: 'boolean', description: 'true=turn on, false=turn off' } },
            required: ['enabled'],
        },
    },
    {
        actionType: 'setCountInBars',
        risk: 'bounded-reversible',
        description: `Set the count-in length in whole bars, from ${MIN_TRANSPORT_BARS} to ${MAX_TRANSPORT_BARS}.`,
        intentPhrases: ['set count-in', 'set the count-in', 'change count-in', 'change the count-in'],
        targetRules: [],
        valueRules: [{ argument: 'bars', kind: 'number-if-present', requiredInPrompt: true }],
        parameters: {
            properties: {
                bars: {
                    type: 'integer',
                    minimum: MIN_TRANSPORT_BARS,
                    maximum: MAX_TRANSPORT_BARS,
                    description: `Whole bars, ${MIN_TRANSPORT_BARS} to ${MAX_TRANSPORT_BARS}`,
                },
            },
            required: ['bars'],
        },
    },
    {
        actionType: 'togglePreRoll',
        risk: 'bounded-reversible',
        description: 'Turn the pre-roll on or off. Always states the wanted state; it never flips the current one.',
        intentPhrases: [
            'turn pre-roll on',
            'turn pre-roll off',
            'enable pre-roll',
            'disable pre-roll',
            'enable the pre-roll',
            'disable the pre-roll',
        ],
        targetRules: [],
        valueRules: [
            {
                argument: 'enabled',
                kind: 'boolean-intent',
                truePhrases: ['turn pre-roll on', 'enable pre-roll', 'enable the pre-roll'],
                falsePhrases: ['turn pre-roll off', 'disable pre-roll', 'disable the pre-roll'],
            },
        ],
        parameters: {
            properties: { enabled: { type: 'boolean', description: 'true=turn on, false=turn off' } },
            required: ['enabled'],
        },
    },
    {
        actionType: 'setPreRollBars',
        risk: 'bounded-reversible',
        description: `Set the pre-roll length in whole bars, from ${MIN_TRANSPORT_BARS} to ${MAX_TRANSPORT_BARS}.`,
        intentPhrases: ['set pre-roll', 'set the pre-roll', 'change pre-roll', 'change the pre-roll'],
        targetRules: [],
        valueRules: [{ argument: 'bars', kind: 'number-if-present', requiredInPrompt: true }],
        parameters: {
            properties: {
                bars: {
                    type: 'integer',
                    minimum: MIN_TRANSPORT_BARS,
                    maximum: MAX_TRANSPORT_BARS,
                    description: `Whole bars, ${MIN_TRANSPORT_BARS} to ${MAX_TRANSPORT_BARS}`,
                },
            },
            required: ['bars'],
        },
    },
] as const satisfies readonly ExecutableAppActionDescriptor[];

export const transportCountInMutationIdentityRulesByType = {
    toggleCountIn: SINGLETON_MUTATION_IDENTITY,
    setCountInBars: SINGLETON_MUTATION_IDENTITY,
    togglePreRoll: SINGLETON_MUTATION_IDENTITY,
    setPreRollBars: SINGLETON_MUTATION_IDENTITY,
} as const;

/** Whether applying the same command twice leaves the state one application leaves. */
export const transportCountInMutationIdempotenceByType = {
    toggleCountIn: true,
    setCountInBars: true,
    togglePreRoll: true,
    setPreRollBars: true,
} as const;
