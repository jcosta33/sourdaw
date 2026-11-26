import { editableMidiClipTargetRules, type ExecutableAppActionDescriptor } from './sharedDescriptorParts';

const MIDI_VELOCITY_CURVES = ['linear', 'exponential', 'logarithmic', 's-curve', 'compress', 'expand'] as const;

/** Whole-clip MIDI note transforms that reshape velocity or timing across every note. */
export const midiNoteTransformDescriptors = [
    {
        actionType: 'scaleVelocities',
        risk: 'broad-reversible',
        description:
            "Remap the velocity of every note in one MIDI clip through a named curve that reshapes the clip's softest-to-loudest span within minVelocity..maxVelocity: linear, exponential, logarithmic and s-curve span the whole range, compress narrows the span toward the middle of it, and expand widens it toward both ends.",
        intentPhrases: ['scale velocity curve', 'apply velocity curve', 'remap midi velocities', 'compress velocities'],
        targetRules: editableMidiClipTargetRules,
        valueRules: [
            { argument: 'curve', kind: 'enum-if-present', values: [...MIDI_VELOCITY_CURVES], requiredInPrompt: true },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
                curve: { type: 'string', enum: [...MIDI_VELOCITY_CURVES], description: 'Velocity response curve' },
                minVelocity: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 127,
                    description: 'Lower bound of the output velocity range, from 1 through 127; defaults to 1',
                },
                maxVelocity: {
                    type: 'integer',
                    minimum: 1,
                    maximum: 127,
                    description: 'Upper bound of the output velocity range, from 1 through 127; defaults to 127',
                },
            },
            required: ['clipId', 'curve'],
        },
    },
    {
        actionType: 'humanizeNotes',
        risk: 'broad-reversible',
        description:
            'Loosen the timing and velocity of every note in one MIDI clip by a seeded random offset; the application fixes the seed when the command is compiled, so redo lands every note exactly where it first landed.',
        intentPhrases: ['humanize notes', 'humanize midi', 'humanize the notes', 'humanize the clip'],
        targetRules: editableMidiClipTargetRules,
        valueRules: [
            {
                argument: 'amount',
                kind: 'number-if-present',
                requiredInPrompt: true,
                match: 'exact',
                scale: 'percentage-only',
            },
        ],
        parameters: {
            properties: {
                clipId: { type: 'string', description: 'Existing unlocked non-empty MIDI clip ID' },
                amount: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description:
                        'Timing looseness from 0 (none) through 1; each note moves by up to an eighth of this many beats either way (never before the clip start), and its velocity too unless velocityAmount is given',
                },
                velocityAmount: {
                    type: 'number',
                    minimum: 0,
                    maximum: 1,
                    description:
                        'Velocity looseness from 0 through 1; each note moves by up to five times this many velocity steps either way; defaults to amount',
                },
            },
            required: ['clipId', 'amount'],
        },
    },
] as const satisfies readonly ExecutableAppActionDescriptor[];
