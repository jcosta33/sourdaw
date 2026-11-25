import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { migrateGrinderPatch } from '../../../models/GrinderPatch';
import { GRINDER_PRESETS } from '../../grinderPresets';
import { captureRectifierHeavyPreset } from '../captureRectifierHeavyPreset';
import { encodeGrinderPatchCommands } from '../encodeGrinderPatchCommands';

function setFixture(type = 'grinder', frozen = false): void {
    const snapshot = sanitizeTrackSnapshot({
        tracks: [
            {
                id: 'track',
                name: 'Guitar',
                kind: 'audio',
                frozen,
                devices: [
                    {
                        id: 'amp',
                        type,
                        name: 'Amp',
                        bypassed: false,
                        parameterValues: { gain: 5, master: 999, unrelated: 42 },
                        deviceState: { version: 1, data: { disclosureTier: 'lab' } },
                    },
                    { id: 'other', type: 'grinder', name: 'Other', bypassed: false, parameterValues: {} },
                ],
            },
        ],
        selectedTrackId: null,
    });
    trackStore.set({ ...defaultTrackState, tracks: snapshot.tracks });
}

describe('captureRectifierHeavyPreset', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Rectifier capture');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setFixture();
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        trackStore.set({ ...defaultTrackState, tracks: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
    });

    it('captures the actual preset footprint and exact existing presence without modifying the projection', () => {
        const preset = GRINDER_PRESETS.find((candidate) => candidate.id === 'gr-rectifier-heavy');
        expect(preset).toBeDefined();
        if (!preset) throw new Error('Rectifier preset missing');
        const commands = encodeGrinderPatchCommands(migrateGrinderPatch(preset.patch));
        const keys = commands.flatMap((command) => (command.kind === 'parameter' ? [command.key] : []));
        const expectedAfter = Object.fromEntries(
            commands.flatMap((command) =>
                command.kind === 'parameter'
                    ? [
                          [
                              command.key,
                              clampDeviceParameterValue({
                                  deviceType: 'grinder',
                                  paramId: command.key,
                                  value: command.value,
                              }),
                          ],
                      ]
                    : []
            )
        );
        const before = structuredClone(trackStore.value);
        const rawBefore = JSON.stringify(getCrdtDoc('root'));
        const capture = captureRectifierHeavyPreset('amp');
        expect(capture).not.toBeNull();
        expect(capture).toMatchObject({ trackId: 'track', deviceId: 'amp', deviceIds: ['amp', 'other'] });
        expect(capture?.parameterIds).toEqual(keys);
        expect(Object.keys(capture!.before.parameterValues)).toEqual(keys);
        expect(Object.keys(capture!.after.parameterValues)).toEqual(keys);
        expect(capture?.before.parameterValues).toMatchObject({ gain: 5, master: 999, bass: null });
        expect(capture?.after.parameterValues).toEqual(expectedAfter);
        expect(capture?.after.parameterValues).toMatchObject({ gain: 9, master: 4, bass: 7, neuralModelMode: 0 });
        expect(capture?.before.deviceState).toEqual({ version: 1, data: { disclosureTier: 'lab' } });
        expect(capture?.after.deviceState).toEqual(capture?.before.deviceState);
        expect(capture?.before.parameterValues).not.toHaveProperty('unrelated');
        expect(capture?.before.parameterValues).not.toHaveProperty('neuralModelSlot');
        expect(trackStore.value).toEqual(before);
        expect(JSON.stringify(getCrdtDoc('root'))).toBe(rawBefore);
    });

    it.each([
        ['wrong type', 'gluten', false],
        ['frozen', 'grinder', true],
    ] as const)('refuses a %s owner without changing the projection', (_reason, type, frozen) => {
        setFixture(type, frozen);
        const before = structuredClone(trackStore.value);
        expect(captureRectifierHeavyPreset('amp')).toBeNull();
        expect(trackStore.value).toEqual(before);
    });

    it('refuses missing or duplicate devices', () => {
        expect(captureRectifierHeavyPreset('missing')).toBeNull();
        const state = trackStore.value!;
        const track = state.tracks[0]!;
        trackStore.set({ ...state, tracks: [{ ...track, devices: [...track.devices, { ...track.devices[0]! }] }] });
        expect(captureRectifierHeavyPreset('amp')).toBeNull();
    });
});
