import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, resetActionReplayAuthority, undo } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { buildLlmActionUserMessage } from '../../transformers/llmActionBridge';
import { bridgeDeviceToolCall } from '../../transformers/llmActionStrategies/deviceStrategy';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';
import { validateActions } from '../validateActions';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: vi.fn(),
}));

function seedLegacyKit(type: string): void {
    const track = createTrack({ id: 'legacy-drums', name: 'Drums', kind: 'midi' });
    track.devices = [{ id: 'old-kit', name: 'Old kit', type, bypassed: false, parameterValues: { kit: 0, gain: 0.8 } }];
    trackStore.set(sanitizeTrackSnapshot({ tracks: [track], selectedTrackId: track.id }));
    flushAutomergeStorageWrites();
    clearUndoHistory();
}

function levelProposal(value = -6) {
    const result = bridgeDeviceToolCall({
        call: {
            id: 'level-call',
            name: 'setDeviceParameter',
            arguments: { deviceId: 'old-kit', paramId: 'level', value },
        },
        context: getProjectContext(),
        index: 0,
        sectionSignatures: [],
    });
    if (!result || !('type' in result) || result.type !== 'setDeviceParameter') {
        throw new Error(`Expected an admitted Level action: ${JSON.stringify(result)}`);
    }
    return result;
}

function levelAction(value = -6) {
    const proposal = levelProposal(value);
    const validated = validateActions([proposal]);
    expect(validated, 'The real runtime validator must admit the bridge proposal').toEqual([proposal]);
    const materialized = materializeActionStateGuards(validated, getProjectContext());
    if (materialized.status !== 'accepted') {
        throw new Error(`Expected materialized Level guards: ${materialized.reason}`);
    }
    const action = materialized.actions[0];
    if (!action || action.type !== 'setDeviceParameter') {
        throw new Error('Expected one materialized Level action');
    }
    return action;
}

function values() {
    return trackStore.value!.tracks[0]!.devices[0]!.parameterValues;
}

function storedValues() {
    const document = getCrdtDoc<{ tracks: ReturnType<typeof sanitizeTrackSnapshot> }>('root');
    return document!.tracks.tracks[0]!.devices[0]!.parameterValues;
}

beforeEach(() => {
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('legacy drum Level test');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    resetActionReplayAuthority();
    setArrangementEventBus({ emit: () => Promise.resolve() });
});

afterEach(() => {
    clearUndoHistory();
    resetActionReplayAuthority();
    clearHandlerRegistry();
    configureAutomergeStoragePort(null);
    removeCrdtDoc('root');
});

describe('legacy drum Level through project context and Command', () => {
    it.each([
        'builtin-drum-kit',
        'builtin-drum-machine-808',
        'builtin-drum-machine-analog',
        'builtin-drum-machine-electronic',
        'builtin-drum-machine-acoustic',
    ])('offers the effective Level on saved %s without writing it', (type) => {
        seedLegacyKit(type);
        const before = values();
        const parameters = getProjectContext().tracks[0]!.devices[0]!.parameters;
        expect(parameters).toContainEqual(expect.objectContaining({ id: 'level', value: 0, valuePresent: false }));
        expect(parameters?.some(({ id }) => id === 'gain')).toBe(false);
        expect(levelAction().payload).toMatchObject({ expectedValuePresent: false });
        expect(levelAction().payload.expectedValue).toBeUndefined();
        expect(values()).toEqual(before);
        expect(values()).not.toHaveProperty('level');
    });

    it('offers the effective Level in both provider messages while the bridge retains absence authority', () => {
        seedLegacyKit('builtin-drum-kit');
        const context = getProjectContext();
        for (const profile of ['hosted', 'local'] as const) {
            const message = buildLlmActionUserMessage({ prompt: 'set old kit Level to -6 dB', context, profile });
            const serialized = message.split('<project_context>')[1]!.split('</project_context>')[0]!;
            const payload = JSON.parse(serialized);
            const device = payload.tracks[0].devices[0];
            if (profile === 'hosted') {
                expect(device.parameters).toContainEqual(
                    expect.objectContaining({ id: 'level', value: 0, valuePresent: false })
                );
            } else {
                expect(device.parameterValues).toEqual({ kit: 0, level: 0 });
            }
        }
        expect(levelAction().payload.expectedValuePresent).toBe(false);
        expect(values()).not.toHaveProperty('level');
    });

    it('keeps an explicitly stored unity Level present and guards its value', () => {
        seedLegacyKit('builtin-drum-kit');
        const state = trackStore.value!;
        const track = state.tracks[0]!;
        trackStore.set({
            ...state,
            tracks: [
                {
                    ...track,
                    devices: track.devices.map((device) => ({
                        ...device,
                        parameterValues: { ...device.parameterValues, level: 0 },
                    })),
                },
            ],
        });
        flushAutomergeStorageWrites();
        expect(getProjectContext().tracks[0]!.devices[0]!.parameters).toContainEqual(
            expect.objectContaining({ id: 'level', value: 0 })
        );
        expect(levelAction().payload.expectedValue).toBe(0);
        expect(levelAction().payload.expectedValuePresent).not.toBe(false);
    });

    it('commits Level, undoes to exact missing-field mix, then redoes through the real handler', async () => {
        seedLegacyKit('builtin-drum-kit');
        const before = values();
        await executeAppAction(levelAction());
        expect(values()).toEqual({ ...before, level: -6 });
        expect(storedValues()).toEqual(values());
        await undo();
        expect(values()).toEqual(before);
        expect(storedValues()).toEqual(before);
        await redo();
        expect(values()).toEqual({ ...before, level: -6 });
        expect(storedValues()).toEqual(values());
    });

    it('rejects an absent-Level proposal after a concurrent writer stores the same effective unity', async () => {
        seedLegacyKit('builtin-drum-kit');
        const proposal = levelProposal();
        const command = levelAction();
        await executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: 'old-kit', paramId: 'level', value: 0 },
        });
        const validated = validateActions([proposal]);
        expect(validated).toEqual([proposal]);
        expect(materializeActionStateGuards(validated, getProjectContext())).toEqual({
            status: 'rejected',
            reason: 'Device parameter state is unavailable or protected: old-kit/level',
        });
        await expect(executeAppAction(command)).rejects.toMatchObject({ name: 'AppActionConflictError' });
        expect(values().level).toBe(0);
        expect(storedValues().level).toBe(0);
    });

    it('refuses an absent-value proposal after a concurrent writer installs Level', async () => {
        seedLegacyKit('builtin-drum-kit');
        const stale = levelAction();
        await executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: 'old-kit', paramId: 'level', value: -3 },
        });
        await expect(executeAppAction(stale)).rejects.toMatchObject({ name: 'AppActionConflictError' });
        expect(values().level).toBe(-3);
        const present = levelAction(-12);
        expect(present.payload.expectedValue).toBe(-3);
        await executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: 'old-kit', paramId: 'level', value: -9 },
        });
        await expect(executeAppAction(present)).rejects.toMatchObject({ name: 'AppActionConflictError' });
        expect(values().level).toBe(-9);
    });
});
