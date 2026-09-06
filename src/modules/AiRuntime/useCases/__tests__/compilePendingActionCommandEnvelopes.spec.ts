import { afterEach, describe, expect, it } from 'vitest';

import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { parseVersionedCommandEnvelope } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { compilePendingActionCommandEnvelopes } from '../compilePendingActionCommandEnvelopes';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;
type AddSidechainRouteAction = Extract<AppAction, { type: 'addSidechainRoute' }>;

function compileTempoGraph(dependenciesByActionIndex: readonly (readonly number[])[]) {
    registerHandlerMap({
        setTempo: {
            describe: () => ({ label: 'Set tempo' }),
            execute: () => undefined,
            undoable: false,
        },
    });
    return () =>
        compilePendingActionCommandEnvelopes({
            actions: [
                { type: 'setTempo', payload: { bpm: 120 } },
                { type: 'setTempo', payload: { bpm: 128 } },
            ],
            actionCommandGraph: { dependenciesByActionIndex, batchLocalBindings: [] },
            actionLabels: ['Set tempo to 120 BPM', 'Set tempo to 128 BPM'],
            group: { groupId: 'group-tempo-graph', groupLabel: 'Set tempo twice' },
            projectRevision: 'revision-graph',
        });
}

function registerDeviceHandlers(): void {
    registerHandlerMap(getArrangementHandlers());
}

function parseCommands(commands: readonly string[]) {
    return commands.map((command) => {
        const parsed = parseVersionedCommandEnvelope(command);
        if (parsed.status !== 'valid') {
            throw new Error(parsed.reason);
        }
        return parsed.envelope;
    });
}

describe('compilePendingActionCommandEnvelopes', () => {
    afterEach(() => {
        clearHandlerRegistry();
    });

    it('freezes the approved effect, group, revision, and typed arguments before confirmation', () => {
        registerHandlerMap({
            setTempo: {
                describe: () => ({ label: 'Generic tempo label' }),
                execute: () => undefined,
                undoable: false,
            },
        });
        const action = { type: 'setTempo', payload: { bpm: 128 } } satisfies SetTempoAction;
        const commands = compilePendingActionCommandEnvelopes({
            actions: [action],
            actionLabels: ['Set tempo from 120 BPM to 128 BPM'],
            group: { groupId: 'group-tempo', groupLabel: 'Set exact tempo' },
            projectRevision: 'revision-1',
        });
        action.payload.bpm = 140;

        const parsed = parseVersionedCommandEnvelope(commands[0] ?? '');
        expect(parsed).toMatchObject({
            status: 'valid',
            envelope: {
                operation: 'setTempo',
                arguments: { bpm: 128 },
                expectedEffect: 'Set tempo from 120 BPM to 128 BPM',
                groupId: 'group-tempo',
                normalizedProjectRevision: 'revision-1',
            },
        });
    });

    it('freezes handler-materialized replay fields before hashing the approved command', () => {
        registerHandlerMap({
            addSidechainRoute: {
                materializeCommandArguments: (action) => {
                    action.payload.targetDeviceId = 'device-compressor';
                    action.payload.targetParameterId = 'threshold';
                    action.payload.gain = 1;
                },
                describe: () => ({ label: 'Add sidechain route', inverseAction: null }),
                execute: () => undefined,
                undoable: true,
            },
        });
        const action = {
            type: 'addSidechainRoute',
            payload: {
                sourceTrackId: 'track-kick',
                targetTrackId: 'track-bass',
                routeId: 'route-1',
            },
        } satisfies AddSidechainRouteAction;

        const [command] = compilePendingActionCommandEnvelopes({
            actions: [action],
            actionLabels: ['Add Kick sidechain to Bass compressor'],
            group: { groupId: 'group-sidechain', groupLabel: 'Add exact sidechain' },
            projectRevision: 'revision-1',
        });

        expect(parseVersionedCommandEnvelope(command ?? '')).toMatchObject({
            status: 'valid',
            envelope: {
                operation: 'addSidechainRoute',
                arguments: {
                    sourceTrackId: 'track-kick',
                    targetTrackId: 'track-bass',
                    targetDeviceId: 'device-compressor',
                    targetParameterId: 'threshold',
                    routeId: 'route-1',
                    gain: 1,
                },
            },
        });
    });

    it.each([
        {
            name: 'declared graph',
            actionCommandGraph: {
                dependenciesByActionIndex: [[], [0], [1], [0]],
                batchLocalBindings: [],
            },
            expectedParameterDependencyIndexes: [1, 0],
        },
        {
            name: 'absent graph',
            actionCommandGraph: undefined,
            expectedParameterDependencyIndexes: [0, 1],
        },
    ])(
        'adds same-track structural device prerequisites with an $name',
        ({ actionCommandGraph, expectedParameterDependencyIndexes }) => {
            registerDeviceHandlers();
            const actions = [
                {
                    type: 'addTrack',
                    payload: {
                        id: 'track-lead',
                        name: 'Lead',
                        kind: 'midi',
                        color: '#456789',
                        initialDeviceId: 'device-synth',
                    },
                },
                {
                    type: 'addDevice',
                    payload: {
                        trackId: 'track-lead',
                        deviceType: 'builtin-filter',
                        deviceId: 'device-filter-a',
                        expectedDeviceIds: ['device-synth'],
                        expectedFrozen: false,
                    },
                },
                {
                    type: 'setDeviceParameter',
                    payload: {
                        deviceId: 'device-filter-a',
                        paramId: 'filter-type',
                        value: 1,
                        expectedTrackId: 'track-lead',
                        expectedDeviceType: 'builtin-filter',
                        expectedDeviceIds: ['device-synth', 'device-filter-a'],
                        expectedValue: 0,
                        expectedTrackFrozen: false,
                    },
                },
                {
                    type: 'addDevice',
                    payload: {
                        trackId: 'track-lead',
                        deviceType: 'builtin-filter',
                        deviceId: 'device-filter-b',
                        expectedDeviceIds: ['device-synth', 'device-filter-a'],
                        expectedFrozen: false,
                    },
                },
            ] satisfies AppAction[];

            const parsed = parseCommands(
                compilePendingActionCommandEnvelopes({
                    actions,
                    ...(actionCommandGraph === undefined ? {} : { actionCommandGraph }),
                    actionLabels: actions.map((action) => action.type),
                    group: { groupId: 'group-device-graph', groupLabel: 'Create device chain' },
                    projectRevision: 'revision-device-graph',
                })
            );

            expect(parsed.map((command) => command.operation)).toEqual([
                'addTrack',
                'addDevice',
                'setDeviceParameter',
                'addDevice',
            ]);
            expect(parsed[1]?.dependencyIds).toEqual([parsed[0]?.commandId]);
            expect(parsed[2]?.dependencyIds).toEqual(
                expectedParameterDependencyIndexes.map((index) => parsed[index]?.commandId)
            );
            expect(parsed[3]?.dependencyIds).toEqual([parsed[0]?.commandId, parsed[1]?.commandId]);
            expect(parsed[0]?.arguments).toMatchObject({ id: 'track-lead', initialDeviceId: 'device-synth' });
            expect(parsed[1]?.arguments).toMatchObject({ deviceId: 'device-filter-a', trackId: 'track-lead' });
            expect(parsed[3]?.arguments).toMatchObject({ deviceId: 'device-filter-b', trackId: 'track-lead' });
        }
    );

    it('does not invent producers for existing devices or device guards on another track', () => {
        registerDeviceHandlers();
        const actions = [
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId: 'device-existing',
                    paramId: 'gain',
                    value: 0.5,
                    expectedTrackId: 'track-existing',
                    expectedDeviceType: 'builtin-gain',
                    expectedDeviceIds: ['device-existing'],
                    expectedValue: 0.25,
                    expectedTrackFrozen: false,
                },
            },
            {
                type: 'addTrack',
                payload: {
                    id: 'track-lead',
                    name: 'Lead',
                    kind: 'midi',
                    color: '#456789',
                    initialDeviceId: 'device-lead-synth',
                },
            },
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-lead',
                    deviceType: 'builtin-filter',
                    deviceId: 'device-lead-filter',
                    expectedDeviceIds: ['device-lead-synth'],
                    expectedFrozen: false,
                },
            },
            {
                type: 'addTrack',
                payload: {
                    id: 'track-reference',
                    name: 'Reference',
                    kind: 'midi',
                    color: '#654321',
                    initialDeviceId: 'device-reference-synth',
                },
            },
            {
                type: 'addDevice',
                payload: {
                    trackId: 'track-reference',
                    deviceType: 'builtin-filter',
                    deviceId: 'device-reference-filter',
                    expectedDeviceIds: ['device-reference-synth', 'device-lead-filter'],
                    expectedFrozen: false,
                },
            },
        ] satisfies AppAction[];

        const parsed = parseCommands(
            compilePendingActionCommandEnvelopes({
                actions,
                actionLabels: actions.map((action) => action.type),
                group: { groupId: 'group-isolated-device-graph', groupLabel: 'Keep device tracks isolated' },
                projectRevision: 'revision-isolated-device-graph',
            })
        );

        expect(parsed[0]?.dependencyIds).toEqual([]);
        expect(parsed[4]?.dependencyIds).toEqual([parsed[3]?.commandId]);
    });

    it('rejects a command graph whose dependency rows do not exactly match the action batch', () => {
        expect(compileTempoGraph([[]])).toThrow('Action command graph does not exactly match the action batch');
    });

    it.each([
        { name: 'duplicate', dependencies: [[], [0, 0]] },
        { name: 'self', dependencies: [[], [1]] },
        { name: 'forward', dependencies: [[1], []] },
        { name: 'out-of-range', dependencies: [[], [9]] },
        { name: 'negative', dependencies: [[], [-1]] },
        { name: 'non-integer', dependencies: [[], [0.5]] },
    ])('rejects a $name action dependency index', ({ dependencies }) => {
        expect(compileTempoGraph(dependencies)).toThrow(
            'Action command graph contains an invalid or out-of-order dependency'
        );
    });
});
