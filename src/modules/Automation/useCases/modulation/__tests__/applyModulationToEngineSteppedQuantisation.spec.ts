import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * F2: modulation is the *last* writer to a device parameter in a scheduler tick,
 * so it decides what the DSP actually holds.
 *
 * `applyAutomation` runs first and now delivers a quantised integer for a
 * parameter the descriptor declares `int`/`bool`/`choice`, recording that
 * delivered integer into `appliedAutomationBases`. `applyModulationToEngine`
 * reads that base, adds its offset and calls `updateDeviceParam` — unquantised.
 * The net effect was that automation's rounding was undone in the same tick by
 * the writer that came after it: a lane holding `bacteria/distortionMode` at 5
 * with a shallow modulation on top handed the worklet 5.7.
 *
 * `distortionMode` DEFAULTS to 0, where the rounded and the raw path agree, so
 * every case below names the two values it drives between.
 */

type MockTrackStoreValue = {
    tracks: Array<{
        id: string;
        automationMode?: 'read' | 'off';
        clips?: Array<{ id: string; startBeat: number; endBeat: number }>;
        devices: Array<{ id: string; type: string; parameterValues: Record<string, number> }>;
    }>;
} | null;

type UpdateDeviceParam = (trackId: string, deviceId: string, paramId: string, value: number) => void;

const { mocks } = vi.hoisted(() => {
    const trackStore: { value: MockTrackStoreValue } = { value: null };
    return { mocks: { updateDeviceParam: vi.fn<UpdateDeviceParam>(), trackStore } };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    resolveEligibleDeviceWriteTarget: (deviceId: string) => {
        const track = mocks.trackStore.value?.tracks.find((candidate) =>
            candidate.devices.some((device) => device.id === deviceId)
        );
        if (!track) {
            return { status: 'missing' };
        }
        return { status: 'eligible', trackId: track.id, deviceId };
    },
    // Not exercised by this spec — stubbed only because this spec's module graph
    // reaches these transitively (through unrelated use cases that share the
    // barrel) and the widened barrel-mock-coverage gate (`stores`) treats every
    // reachable import as required, even one only read inside a function body
    // this spec's tests never call.
    persistDeviceParam: vi.fn(),
    getTrackEligibility: vi.fn(),
    shouldCreateLiveTrackStrip: vi.fn(),
    deriveEffectiveAudibility: vi.fn(),
    adjustmentLayerStore: { value: null },
    vcaGroupStore: { value: null },
    deriveVcaMultiplier: vi.fn(),
    getVcaGroupsState: vi.fn(),
    gainEnvelopeStore: { value: null },
    warpStates: new Map(),
    getWarpState: vi.fn(),
    addWarpMarker: vi.fn(),
    clipSelectionStore: { value: null },
    resolveEligibleClipWriteTarget: vi.fn(),
    updateClipInStore: vi.fn(),
    appendClipToTrack: vi.fn(),
    clampDeviceParamWrite: vi.fn(),
    takeLaneStore: { value: null },
    markerStore: { value: null },
}));

import { getPluginById, quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { automationStore } from '../../../stores/automationStore';
import { modulationStore } from '../../../stores/modulationStore';
import { applyModulationToEngine } from '../applyModulationToEngine';
import { setModulationDependencies } from '../modulationDependencies';
import { resetModulationSlew } from '../resetModulationSlew';

/** `bacteria/distortionMode`: declared `int`, min 0 / max 8 — nine legal modes. */
const DISTORTION_MODE_SPAN = 8;

function seedModulator(amount: number): void {
    modulationStore.set({
        modulators: [
            {
                id: 'lfo1',
                name: 'LFO',
                trackId: 't1',
                kind: 'lfo',
                config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'distortionMode', amount }],
                enabled: true,
            },
        ],
    });
}

/** What `applyAutomation` recorded this tick: the *delivered* integer index. */
function automationBase(value: number): ReadonlyMap<string, ReadonlyMap<string, number>> {
    return new Map([['d1', new Map([['distortionMode', value]])]]);
}

describe('applyModulationToEngine — stepped device parameters', () => {
    beforeEach(() => {
        resetModulationSlew();
        automationStore.set({ lanes: [] });
        mocks.updateDeviceParam.mockReset();
        setModulationDependencies({
            updateDeviceParam: mocks.updateDeviceParam,
            getPluginParamRange: (deviceType, paramId) => {
                const paramDef = getPluginById(deviceType)?.parameters.find((param) => param.id === paramId);
                if (!paramDef) {
                    return null;
                }
                return {
                    min: paramDef.minValue,
                    max: paramDef.maxValue,
                    defaultValue: paramDef.defaultValue,
                    automatable: paramDef.automatable,
                };
            },
            quantiseValue: quantiseDeviceParameterValue,
        });
        // The persisted base is 0 (the parameter's default). Every case below
        // supplies an automation base of 5 instead, so a delivered 6 can only
        // have come from 5 + the modulation offset — not from the persisted 0.
        mocks.trackStore.value = {
            tracks: [
                {
                    id: 't1',
                    automationMode: 'read',
                    clips: [],
                    devices: [{ id: 'd1', type: 'bacteria', parameterValues: { distortionMode: 0 } }],
                },
            ],
        };
    });

    it('delivers the next legal mode, not base + a fractional offset', () => {
        // At beat 1 this modulator evaluates to +1, so the offset is
        // `amount * span`. 0.0875 * 8 = 0.7 — enough to carry mode 5 to mode 6,
        // and a value the rounded path and the raw path disagree on.
        seedModulator(0.7 / DISTORTION_MODE_SPAN);

        applyModulationToEngine(1, undefined, automationBase(5));

        expect(mocks.updateDeviceParam).toHaveBeenCalledTimes(1);
        const [trackId, deviceId, paramId, value] = mocks.updateDeviceParam.mock.calls[0]!;
        expect([trackId, deviceId, paramId]).toEqual(['t1', 'd1', 'distortionMode']);
        // 5.7 before the fix. Not 5 either — the offset really does move it.
        expect(value).toBe(6);
    });

    it('leaves a shallow modulation on the index automation delivered', () => {
        // 0.0175 * 8 = 0.14: a real offset the parameter cannot express. The
        // engine holds mode 5 either way, and the point is that it is handed 5
        // and not 5.14 — an index no `match` arm in Rust names.
        seedModulator(0.14 / DISTORTION_MODE_SPAN);

        applyModulationToEngine(1, undefined, automationBase(5));

        const [, , , value] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(value).toBe(5);
    });

    it('still writes fractional values for a float parameter', () => {
        // The complement, so the fix cannot be "round every modulation write".
        // `bacteria/mix` declares step 0.01 and maps to `float`.
        mocks.trackStore.value = {
            tracks: [
                {
                    id: 't1',
                    automationMode: 'read',
                    clips: [],
                    devices: [{ id: 'd1', type: 'bacteria', parameterValues: { mix: 0 } }],
                },
            ],
        };
        modulationStore.set({
            modulators: [
                {
                    id: 'lfo1',
                    name: 'LFO',
                    trackId: 't1',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'sine', rate: 4, sync: true, phase: 0, depth: 1 },
                    mappings: [{ targetTrackId: 't1', targetDeviceId: 'd1', targetParamId: 'mix', amount: 0.37 }],
                    enabled: true,
                },
            ],
        });

        applyModulationToEngine(1, undefined, new Map([['d1', new Map([['mix', 0.25]])]]));

        const [, , , value] = mocks.updateDeviceParam.mock.calls[0]!;
        expect(value).toBeCloseTo(0.62, 10);
    });
});
