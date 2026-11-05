import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import {
    createTrack,
    getArrangementHandlers,
    getFactoryPresets,
    setArrangementEventBus,
} from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { type RetainedCommand } from '../../models/RetainedCompilation';
import { expandMixRecipe } from '../expandMixRecipe';
import { getProjectContext } from '../getProjectContext';

const EXPANDED_TRACK = 'expanded-track';
const STATED_TRACK = 'stated-track';

function readString(value: unknown, field: string): string {
    if (typeof value !== 'string') {
        throw new Error(`expanded command field ${field} is not a string`);
    }
    return value;
}

function readNumber(value: unknown, field: string): number {
    if (typeof value !== 'number') {
        throw new Error(`expanded command field ${field} is not a number`);
    }
    return value;
}

type DeviceAction = Parameters<typeof executeAppAction>[0];

/**
 * Commits one action to the project. This spec reads project truth only, and the test environment has
 * no audio graph to realize a strip in, so an action that committed with its runtime effect pending
 * counts as applied, as the owner's own add-device door treats it.
 */
async function commit(action: DeviceAction): Promise<void> {
    try {
        await executeAppAction(action);
    } catch (error) {
        if (!isAppActionCommittedError(error)) {
            throw error;
        }
    }
}

/** A `$binding` reference names the device the bound `addDevice` minted; anything else is a device id. */
function resolveDeviceId(reference: string, minted: ReadonlyMap<string, string>): string {
    if (!reference.startsWith('$')) {
        return reference;
    }
    const deviceId = minted.get(reference.slice(1));
    if (deviceId === undefined) {
        throw new Error(`no addDevice minted ${reference}`);
    }
    return deviceId;
}

/** Runs an expansion's commands through the registered handlers, in order, as a batch would. */
async function applyExpansion(commands: readonly RetainedCommand[]): Promise<void> {
    const minted = new Map<string, string>();
    for (const command of commands) {
        if (command.operation === 'addDevice') {
            const deviceId = `expanded-device-${String(minted.size)}`;
            const after = command.arguments.afterDeviceId;
            await commit({
                type: 'addDevice',
                payload: {
                    trackId: readString(command.arguments.trackId, 'trackId'),
                    deviceType: readString(command.arguments.deviceType, 'deviceType'),
                    deviceId,
                    ...(after === undefined
                        ? {}
                        : { afterDeviceId: resolveDeviceId(readString(after, 'after'), minted) }),
                },
            });
            minted.set(readString(command.binding, 'binding'), deviceId);
            continue;
        }
        await commit({
            type: 'setDeviceParameter',
            payload: {
                deviceId: resolveDeviceId(readString(command.arguments.deviceId, 'deviceId'), minted),
                paramId: readString(command.arguments.paramId, 'paramId'),
                value: readNumber(command.arguments.value, 'value'),
            },
        });
    }
}

/** Adds every device of the preset and writes every value it states, leaving none out. */
async function applyEveryStatedValue(presetId: string): Promise<void> {
    const preset = getFactoryPresets().find((candidate) => candidate.id === presetId);
    if (preset === undefined) {
        throw new Error(`factory preset ${presetId} is not in the library`);
    }
    for (const [index, device] of preset.devices.entries()) {
        const deviceId = `stated-device-${String(index)}`;
        await commit({
            type: 'addDevice',
            payload: {
                trackId: STATED_TRACK,
                deviceType: device.type,
                deviceId,
                ...(index === 0 ? {} : { afterDeviceId: `stated-device-${String(index - 1)}` }),
            },
        });
        for (const [paramId, value] of Object.entries(device.parameterValues)) {
            await commit({ type: 'setDeviceParameter', payload: { deviceId, paramId, value } });
        }
    }
}

function chainOn(trackId: string) {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    return (track?.devices ?? []).map((device) => ({ type: device.type, parameterValues: device.parameterValues }));
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('Preset recipe application');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    setArrangementEventBus({ emit: () => Promise.resolve() });
});

afterEach(() => {
    clearHandlerRegistry();
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('a preset recipe applied through its expansion', () => {
    // Red when a left-out write was not already held by the added device, so the chains differ.
    it.each([
        ['fx-eq-high-cut', 'preset:fx-eq-high-cut:dark', 'audio', null],
        ['fx-chain-master-bus', 'preset:fx-chain-master-bus:glued', 'bus', 'bus'],
    ] as const)(
        '%s leaves its chain exactly as writing every stated value does',
        async (presetId, recipeId, kind, role) => {
            trackStore.set({
                tracks: [
                    createTrack({ id: EXPANDED_TRACK, name: 'Expanded', kind }),
                    createTrack({ id: STATED_TRACK, name: 'Stated', kind }),
                ],
                selectedTrackId: null,
                ghostClips: [],
            });

            const expansion = expandMixRecipe(
                { recipeId, targetId: EXPANDED_TRACK, role, values: [] },
                getProjectContext(),
                1
            );
            if (expansion.status !== 'expanded') {
                throw new Error(`expansion refused: ${expansion.reason}`);
            }
            const statedWrites = expansion.values.length;
            const emittedWrites = expansion.commands.filter(
                (command) => command.operation === 'setDeviceParameter'
            ).length;

            await applyExpansion(expansion.commands);
            await applyEveryStatedValue(presetId);

            expect(emittedWrites).toBeLessThan(statedWrites);
            expect(chainOn(EXPANDED_TRACK)).toEqual(chainOn(STATED_TRACK));
            expect(chainOn(EXPANDED_TRACK).length).toBeGreaterThan(0);
        }
    );
});
