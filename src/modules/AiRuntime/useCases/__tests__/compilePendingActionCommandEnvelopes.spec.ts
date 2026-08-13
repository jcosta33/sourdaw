import { afterEach, describe, expect, it } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { parseVersionedCommandEnvelope } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { compilePendingActionCommandEnvelopes } from '../compilePendingActionCommandEnvelopes';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;
type AddSidechainRouteAction = Extract<AppAction, { type: 'addSidechainRoute' }>;

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
});
