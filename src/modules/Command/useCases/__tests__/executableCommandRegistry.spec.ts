import { describe, expect, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';

import { getAppActionExecutionPolicy } from '../getAppActionExecutionPolicy';
import { getExecutableAppActionToolSchemas } from '../getExecutableAppActionToolSchemas';

function expectedCommand(
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    risk: string,
    requiresConfirmation: boolean
) {
    return {
        name,
        description,
        properties,
        required,
        additionalProperties: false,
        classification: 'explicit',
        risk,
        requiresConfirmation,
    };
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

describe('executable command registry', () => {
    it('derives the exact duplicate-free provider tool schema and execution policy', () => {
        const schemas = getExecutableAppActionToolSchemas();
        const actual = schemas.map((schema) => {
            const policy = getAppActionExecutionPolicy(schema.function.name);
            return {
                name: schema.function.name,
                description: schema.function.description,
                properties: schema.function.parameters.properties,
                required: schema.function.parameters.required,
                additionalProperties: schema.function.parameters.additionalProperties,
                classification: policy.classification,
                risk: policy.risk,
                requiresConfirmation: policy.requiresConfirmation,
            };
        });

        expect(actual).toEqual(EXPECTED_COMMANDS);
        expect(new Set(actual.map((command) => command.name)).size).toBe(actual.length);
    });

    it('maps every provider-executable action to exactly one production handler with executable metadata', () => {
        const handlerMaps: readonly Record<string, unknown>[] = [getArrangementHandlers(), getTransportHandlers()];

        expect(
            EXPECTED_COMMANDS.map((command) => {
                const owners = handlerMaps.filter((handlerMap) => Object.hasOwn(handlerMap, command.name));
                const handler = owners[0]?.[command.name];
                if (typeof handler !== 'object' || handler === null) {
                    return { actionType: command.name, ownerCount: owners.length, handler: null };
                }
                return {
                    actionType: command.name,
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
                actionType: command.name,
                ownerCount: 1,
                handler: { execute: 'function', describe: 'function', undoable: 'boolean' },
            }))
        );
    });
});
