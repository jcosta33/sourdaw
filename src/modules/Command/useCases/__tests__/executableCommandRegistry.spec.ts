import { describe, expect, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { getAppActionExecutionPolicy } from '../getAppActionExecutionPolicy';
import { getExecutableAppActionGroundingRules } from '../getExecutableAppActionGroundingRules';
import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';

type ExpectedCommandArgs = [string, string, Record<string, unknown>, string[], string, boolean];

function expectedCommand(...args: ExpectedCommandArgs) {
    const [name, description, properties, required, risk, requiresConfirmation] = args;
    return [name, description, properties, required, false, 'explicit', risk, requiresConfirmation] as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const EXPECTED_COMMANDS = [
    expectedCommand(
        'addTrack',
        'Create a new track in the session.',
        {
            name: { type: 'string', description: 'Display name (e.g. "Kick", "Vocals", "Synth Pad")' },
            kind: { type: 'string', enum: ['audio', 'midi', 'bus', 'folder'], description: 'Track type' },
        },
        ['name', 'kind'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'renameTrack',
        'Rename a track.',
        { trackId: { type: 'string' }, name: { type: 'string' } },
        ['trackId', 'name'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'muteTrack',
        'Mute or unmute a track.',
        {
            trackId: { type: 'string' },
            muted: { type: 'boolean', description: 'true=mute, false=unmute' },
        },
        ['trackId', 'muted'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'soloTrack',
        'Solo or unsolo a track (only hear this track).',
        {
            trackId: { type: 'string' },
            soloed: { type: 'boolean', description: 'true=solo, false=unsolo' },
        },
        ['trackId', 'soloed'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'duplicateTrack',
        'Duplicate a track with all clips and devices.',
        { trackId: { type: 'string' } },
        ['trackId'],
        'broad-reversible',
        true
    ),
    expectedCommand(
        'setTrackGain',
        'Set track volume. 0.0=silence, 0.8=default, 1.0=max.',
        { trackId: { type: 'string' }, gain: { type: 'number', description: '0.0 to 1.0' } },
        ['trackId', 'gain'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setTrackPan',
        'Pan a track left/right. -50=hard left, 0=center, 50=hard right.',
        { trackId: { type: 'string' }, pan: { type: 'number', description: '-50 to 50' } },
        ['trackId', 'pan'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setTrackColor',
        'Color-code a track for visual organization.',
        {
            trackId: { type: 'string' },
            color: { type: 'string', description: 'Six-digit hexadecimal color (for example #ff5500)' },
        },
        ['trackId', 'color'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'reorderTrack',
        'Move a track to a new position in the track list.',
        { trackId: { type: 'string' }, newIndex: { type: 'number', description: '0-based index in the track list' } },
        ['trackId', 'newIndex'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'setTempo',
        'Set the project tempo in BPM. Range: 20–300.',
        { bpm: { type: 'number' } },
        ['bpm'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setTimeSignature',
        'Set the project time signature.',
        {
            numerator: { type: 'integer', description: 'Whole-number beat count from 1 through 32' },
            denominator: { type: 'integer', enum: [2, 4, 8, 16], description: 'Beat unit' },
        },
        ['numerator', 'denominator'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setDeviceParameter',
        'Adjust a parameter on an existing device.',
        {
            deviceId: { type: 'string' },
            paramId: { type: 'string', description: 'Parameter name (e.g. "frequency", "ratio", "mix", "threshold")' },
            value: { type: 'number', description: 'Parameter value (range depends on the parameter)' },
        },
        ['deviceId', 'paramId', 'value'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'bypassDevice',
        'Bypass or re-enable an effect (keeps settings, just disables processing).',
        { deviceId: { type: 'string' }, bypassed: { type: 'boolean' } },
        ['deviceId', 'bypassed'],
        'bounded-reversible',
        false
    ),
    expectedCommand(
        'addSend',
        "Route a copy of a track's signal to a bus (parallel processing).",
        {
            trackId: { type: 'string' },
            busId: { type: 'string' },
            level: { type: 'number', description: 'Send level 0.0–1.0' },
        },
        ['trackId', 'busId', 'level'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setSend',
        'Adjust the send level from a track to a bus.',
        { trackId: { type: 'string' }, busId: { type: 'string' }, level: { type: 'number' } },
        ['trackId', 'busId', 'level'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'removeSend',
        'Remove a send from a track to a bus.',
        { trackId: { type: 'string' }, busId: { type: 'string' } },
        ['trackId', 'busId'],
        'authority-sensitive',
        true
    ),
    expectedCommand(
        'setTrackOutput',
        "Route a track's output to a specific bus or master.",
        {
            trackId: { type: 'string' },
            outputId: { type: 'string', description: 'Destination track/bus ID' },
        },
        ['trackId', 'outputId'],
        'authority-sensitive',
        true
    ),
];

const EXPECTED_GROUNDING = [
    {
        actionType: 'addTrack',
        intentPhrases: [
            'add track',
            'create track',
            'add new track',
            'create new track',
            'add audio track',
            'create audio track',
            'add an audio track',
            'create an audio track',
            'add midi track',
            'create midi track',
            'add a midi track',
            'create a midi track',
            'add bus track',
            'create bus track',
            'add a bus track',
            'create a bus track',
            'add folder track',
            'create folder track',
            'add a folder track',
            'create a folder track',
        ],
        targetRules: [],
        valueRules: [
            { argument: 'name', kind: 'text-after-keyword-if-present', keywords: ['named', 'called'] },
            { argument: 'kind', kind: 'enum-if-present', values: ['audio', 'midi', 'bus', 'folder'] },
        ],
    },
    {
        actionType: 'renameTrack',
        intentPhrases: ['rename'],
        targetRules: [{ argument: 'trackId', capability: 'track', promptRole: 'source' }],
        valueRules: [{ argument: 'name', kind: 'text-after-connector', connector: 'to' }],
    },
    {
        actionType: 'muteTrack',
        intentPhrases: ['mute', 'unmute'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [
            {
                argument: 'muted',
                kind: 'boolean-intent',
                truePhrases: ['mute'],
                falsePhrases: ['unmute'],
            },
        ],
    },
    {
        actionType: 'soloTrack',
        intentPhrases: ['solo', 'unsolo'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [
            {
                argument: 'soloed',
                kind: 'boolean-intent',
                truePhrases: ['solo'],
                falsePhrases: ['unsolo'],
            },
        ],
    },
    {
        actionType: 'duplicateTrack',
        intentPhrases: ['duplicate', 'copy'],
        targetRules: [{ argument: 'trackId', capability: 'duplicable-track' }],
        valueRules: [],
    },
    {
        actionType: 'setTrackGain',
        intentPhrases: ['gain', 'volume', 'louder', 'quieter', 'raise', 'lower', 'turn up', 'turn down'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [
            {
                argument: 'gain',
                kind: 'number-if-present',
                scale: 'unit-interval',
                qualitativeDirection: 'track-gain',
            },
        ],
    },
    {
        actionType: 'setTrackPan',
        intentPhrases: ['pan', 'left', 'right', 'center'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [
            { argument: 'pan', kind: 'number-if-present', direction: 'pan', qualitativeDirection: 'track-pan' },
        ],
    },
    {
        actionType: 'setTrackColor',
        intentPhrases: ['color', 'colour'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [{ argument: 'color', kind: 'string-literal' }],
    },
    {
        actionType: 'reorderTrack',
        intentPhrases: ['reorder', 'move'],
        targetRules: [{ argument: 'trackId', capability: 'track' }],
        valueRules: [{ argument: 'newIndex', kind: 'number-if-present' }],
    },
    {
        actionType: 'setTempo',
        intentPhrases: ['set tempo', 'change tempo', 'tempo'],
        targetRules: [],
        valueRules: [{ argument: 'bpm', kind: 'number-if-present' }],
    },
    {
        actionType: 'setTimeSignature',
        intentPhrases: [
            'set time signature',
            'set the time signature',
            'change time signature',
            'change the time signature',
            'set meter',
            'set the meter',
            'change meter',
            'change the meter',
        ],
        targetRules: [],
        valueRules: [{ argument: 'numerator', denominatorArgument: 'denominator', kind: 'time-signature' }],
    },
    {
        actionType: 'setDeviceParameter',
        intentPhrases: ['adjust', 'set', 'change', 'increase', 'decrease'],
        targetRules: [
            { argument: 'deviceId', capability: 'device' },
            { argument: 'paramId', capability: 'device-parameter', dependsOn: 'deviceId' },
        ],
        valueRules: [{ argument: 'value', kind: 'number-if-present', qualitativeDirection: 'device-parameter' }],
    },
    {
        actionType: 'bypassDevice',
        intentPhrases: ['bypass', 'enable', 'disable', 're-enable'],
        targetRules: [{ argument: 'deviceId', capability: 'device' }],
        valueRules: [
            {
                argument: 'bypassed',
                kind: 'boolean-intent',
                truePhrases: ['bypass', 'disable'],
                falsePhrases: ['enable', 're-enable'],
            },
        ],
    },
    ...['addSend', 'setSend', 'removeSend'].map((actionType, index) => ({
        actionType,
        intentPhrases: [
            ['add send', 'create send', 'send'],
            ['adjust send', 'set send', 'change send'],
            ['remove send', 'delete send', 'disconnect send'],
        ][index],
        targetRules: [
            { argument: 'busId', capability: 'bus', promptRole: 'destination' },
            { argument: 'trackId', capability: 'routable-source', distinctFrom: 'busId', promptRole: 'source' },
        ],
        valueRules: index < 2 ? [{ argument: 'level', kind: 'number-if-present', scale: 'unit-interval' }] : [],
    })),
    {
        actionType: 'setTrackOutput',
        intentPhrases: ['route', 'set output', 'output'],
        targetRules: [
            { argument: 'outputId', capability: 'output', promptRole: 'destination' },
            { argument: 'trackId', capability: 'routable-source', distinctFrom: 'outputId', promptRole: 'source' },
        ],
        valueRules: [],
    },
];

describe('executable command registry', () => {
    it('derives the exact duplicate-free provider tool schema and execution policy', () => {
        const schemas = getExecutableAppActionToolSchemas();
        const actual = schemas.map((schema) => {
            const policy = getAppActionExecutionPolicy(schema.function.name);
            return [
                schema.function.name,
                schema.function.description,
                schema.function.parameters.properties,
                schema.function.parameters.required,
                schema.function.parameters.additionalProperties,
                policy.classification,
                policy.risk,
                policy.requiresConfirmation,
            ];
        });

        expect(actual).toEqual(EXPECTED_COMMANDS);
    });

    it('isolates nested schema data between generated provider surfaces', () => {
        const firstProperties = getExecutableAppActionToolSchemas()[0]?.function.parameters.properties;
        if (!firstProperties) {
            throw new Error('addTrack schema is unavailable');
        }
        const originalProperties = structuredClone(firstProperties);
        const firstNameProperty: unknown = Reflect.get(firstProperties, 'name');
        if (!isRecord(firstNameProperty)) {
            throw new Error('addTrack name schema is unavailable');
        }

        firstNameProperty.description = 'mutated by provider adapter';

        expect(getExecutableAppActionToolSchemas()[0]?.function.parameters.properties).toEqual(originalProperties);
    });

    it('pins the complete intent, target, and value grounding map', () => {
        const actual = EXPECTED_COMMANDS.map((command) => getExecutableAppActionGroundingRules(command[0]));

        expect(actual).toEqual(EXPECTED_GROUNDING);
    });

    it('maps every provider-executable action to exactly one production handler with executable metadata', () => {
        const handlerMaps: readonly Record<string, unknown>[] = [getArrangementHandlers(), getTransportHandlers()];

        expect(
            EXPECTED_COMMANDS.map((command) => {
                const owners = handlerMaps.filter((handlerMap) => Object.hasOwn(handlerMap, command[0]));
                const handler = owners[0]?.[command[0]];
                if (typeof handler !== 'object' || handler === null) {
                    return { actionType: command[0], ownerCount: owners.length, handler: null };
                }
                return {
                    actionType: command[0],
                    ownerCount: owners.length,
                    handler: {
                        execute: typeof Reflect.get(handler, 'execute'),
                        describe: typeof Reflect.get(handler, 'describe'),
                        undoable: typeof Reflect.get(handler, 'undoable'),
                    },
                };
            })
        ).toEqual(
            EXPECTED_COMMANDS.map((command) => ({
                actionType: command[0],
                ownerCount: 1,
                handler: { execute: 'function', describe: 'function', undoable: 'boolean' },
            }))
        );
    });
});
