import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import {
    getCompensationDelay,
    getCurrentTime,
    scheduleTrackPan,
    updateDeviceParam,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation, resolveAutoMatchValue } from '#/modules/Automation/useCases';
import { applyFermenterRuntimeParam } from '#/modules/Fermenter/useCases';

import { appliedAutomationBases } from '../appliedAutomationBases';
import { applyAutomation } from '../applyAutomation';

/**
 * Live-playback guard: a lane on a **stepped** device parameter must deliver an
 * exact integer to the DSP on every tick.
 *
 * The applier slews every device param through a first-order IIR
 * (`slewStep`, α = 0.4) and then passes the smoothed value through
 * `clampDeviceParameterValue`, which used to bound the range and nothing else.
 * A ride between two engine indices therefore handed the WASM node
 * `2.4, 4.08, 5.048, …` for a parameter the descriptor declares `int`.
 *
 * Both cases below name the two values they drive between, and both pairs are
 * chosen so the fractional path and the integer path *disagree*: a guard parked
 * at a parameter's default (Fermenter `oscEngine` defaults to 0) proves nothing,
 * because 0 rounds to 0 and the defect is invisible there.
 */

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    const trackStore: { value: typeof mod.trackStore.value } = {
        value: { tracks: [], selectedTrackId: null },
    };
    return {
        ...mod,
        deriveVcaMultiplier: vi.fn(() => 1),
        trackStore,
        resolveEligibleDeviceWriteTarget: vi.fn((deviceId: string) => {
            const owner = trackStore.value?.tracks.find((candidate) =>
                candidate.devices.some((device) => device.id === deviceId)
            );
            if (!owner) {
                return { status: 'missing' };
            }
            return { status: 'eligible', trackId: owner.id, deviceId };
        }),
    };
});
vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return {
        ...mod,
        automationStore: { value: { lanes: [] } },
    };
});
vi.mock('#/modules/Automation/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/useCases')>();
    return {
        ...mod,
        getAutomationValueAtBeat: vi.fn(() => 0),
        isRecordingAutomation: vi.fn(() => false),
        resolveAutoMatchValue: vi.fn(({ automationValue }: { automationValue: number }) => ({
            value: automationValue,
            isReleaseStart: false,
        })),
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...mod,
        scheduleTrackGain: vi.fn(),
        scheduleTrackPan: vi.fn(),
        getCurrentTime: vi.fn(() => 5),
        getCompensationDelay: vi.fn(() => 0),
        updateDeviceParam: vi.fn(),
        updateMidiFxParam: vi.fn(),
    };
});
vi.mock('#/modules/Fermenter/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Fermenter/useCases')>();
    return {
        ...mod,
        applyFermenterRuntimeParam: vi.fn(),
        setFermenterMappedParam: vi.fn(),
    };
});

type MutableTrackStore = { value: { tracks: unknown[] } };
type MutableAutomationStore = { value: { lanes: unknown[] } };

const mutableTrackStore = trackStore as unknown as MutableTrackStore;
const mutableAutomationStore = automationStore as unknown as MutableAutomationStore;

const TICKS = 12;

function seedSteppedLane(options: { deviceId: string; deviceType: string; paramId: string; startValue: number }): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'audio',
                automationMode: 'read',
                clips: [],
                midiFx: [],
                devices: [
                    {
                        id: options.deviceId,
                        type: options.deviceType,
                        parameterValues: { [options.paramId]: options.startValue },
                    },
                ],
            },
        ],
    };
    mutableAutomationStore.value = {
        lanes: [
            {
                id: 'lane-1',
                trackId: 'track-1',
                parameterId: `${options.deviceId}:${options.paramId}`,
                minValue: 0,
                points: [{ beat: 0, value: options.startValue }],
            },
        ],
    };
}

/** Run one seed tick at `startValue`, then `TICKS` ticks riding to `endValue`. */
function ride({ startValue, endValue }: { startValue: number; endValue: number }): void {
    vi.mocked(getAutomationValueAtBeat).mockReturnValue(startValue);
    applyAutomation(0);
    vi.mocked(getAutomationValueAtBeat).mockReturnValue(endValue);
    for (let tick = 1; tick <= TICKS; tick += 1) {
        applyAutomation(tick);
    }
}

describe('applyAutomation — stepped device parameters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isRecordingAutomation).mockReturnValue(false);
        vi.mocked(getCurrentTime).mockReturnValue(5);
        vi.mocked(getCompensationDelay).mockReturnValue(0);
        vi.mocked(resolveAutoMatchValue).mockImplementation(({ automationValue }: { automationValue: number }) => ({
            value: automationValue,
            isReleaseStart: false,
        }));
    });

    it("delivers only integers to Fermenter's oscEngine while riding 0 → 6", () => {
        // `oscEngine` is declared `int`, min 0 / max 6, and selects the
        // oscillator engine. It DEFAULTS to 0; the ride therefore starts at 0
        // and targets 6, so the slew's intermediate values (2.4, 4.08, 5.048 …)
        // are all strictly between two distinct legal indices — a value the
        // rounded path and the raw path disagree on.
        seedSteppedLane({ deviceId: 'device-f1', deviceType: 'fermenter', paramId: 'oscEngine', startValue: 0 });

        ride({ startValue: 0, endValue: 6 });

        const delivered = vi.mocked(applyFermenterRuntimeParam).mock.calls.map(([input]) => input.value);

        expect(delivered.filter((value) => !Number.isInteger(value))).toEqual([]);
        // The whole step curve, pinned. Three things at once: it arrives at 6
        // (a quantised slew *state* would dead-zone at 5 and never get there),
        // it visits more than one index (a ride parked at the default would
        // satisfy the integer assertion vacuously), and it never re-sends an
        // index the engine is already holding across the twelve ticks.
        //
        // Measured: the slew (α = 0.4) produces 2.4, 4.08, 5.048, 5.629,
        // 5.777, … which round to 2, 4, 5, 6, 6, … and dedupe to this.
        expect(delivered).toEqual([2, 4, 5, 6]);
    });

    it('records the delivered index as the modulation base, not the continuous filter value', () => {
        // A parameter that is both automated and modulated composes the
        // modulation offset onto the base this tick applied. Once the parameter
        // is stepped, the value the engine is holding is the *delivered*
        // integer, not the 5.777 the filter carries — recording the filter value
        // would offset from a number the DSP never saw.
        seedSteppedLane({ deviceId: 'device-f1', deviceType: 'fermenter', paramId: 'oscEngine', startValue: 0 });

        ride({ startValue: 0, endValue: 6 });

        const base = appliedAutomationBases.get('device-f1')?.get('oscEngine');
        expect(base).toBe(6);
        expect(base).toBe(
            vi
                .mocked(applyFermenterRuntimeParam)
                .mock.calls.map(([input]) => input.value)
                .at(-1)
        );
    });

    it("delivers only integers to Bacteria's distortionMode while riding 0 → 8", () => {
        // Non-Fermenter devices reach the DSP through `updateDeviceParam`, a
        // separate dispatch arm. `distortionMode` is `int`, min 0 / max 8, and
        // its default is 0 — again the ride's endpoints disagree under rounding.
        seedSteppedLane({
            deviceId: 'device-b1',
            deviceType: 'bacteria',
            paramId: 'distortionMode',
            startValue: 0,
        });

        ride({ startValue: 0, endValue: 8 });

        const delivered = vi.mocked(updateDeviceParam).mock.calls.map(([, , , value]) => value);

        expect(delivered.filter((value) => !Number.isInteger(value))).toEqual([]);
        // Measured: 3.2, 5.12, 6.272, 6.963, 7.378, … rounding and deduping to
        // this step curve, which arrives at mode 8 rather than dead-zoning at 7.
        expect(delivered).toEqual([3, 5, 6, 7, 8]);
        expect(scheduleTrackPan).not.toHaveBeenCalled();
    });

    it("delivers only factors the cascade builds to Crust's oversampling while riding 1 → 32", () => {
        // An integer is not enough for a parameter whose engine distinguishes
        // fewer settings than its range. `crust/oversampling` declares 1..32,
        // and `crates/daw-dsp/src/crust/oversample.rs` builds {1,2,4,8,16,32};
        // before the legal set was declared this ride handed the node 9, 14,
        // 21 and 26, each of which the engine silently re-snapped while the
        // Inspector and the lane both read back the number nobody was playing.
        seedSteppedLane({
            deviceId: 'device-c1',
            deviceType: 'crust',
            paramId: 'oversampling',
            startValue: 1,
        });

        ride({ startValue: 1, endValue: 32 });

        const delivered = vi.mocked(updateDeviceParam).mock.calls.map(([, , , value]) => value);
        const legal = [1, 2, 4, 8, 16, 32];

        expect(delivered.filter((value) => !legal.includes(value))).toEqual([]);
        // Pinned in full, because "every delivery is legal" is satisfied by a
        // ride that never leaves its starting factor. The slew (α = 0.4) runs
        // 13.4, 20.8, 25.3, 28.0, 29.6, 30.6, 31.1, 31.5, 31.7, … which the
        // integer law rounds to 13, 21, 25, 28, 30, 31, 31, 32 — every one of
        // the first six an oversampling factor the cascade cannot build, and
        // exactly what this node used to be handed. Resolved onto the set and
        // deduped by the repeat gate, the same ride is three factors. It still
        // arrives at 32 rather than stalling under it.
        expect(delivered).toEqual([8, 16, 32]);
        expect(scheduleTrackPan).not.toHaveBeenCalled();
    });

    it('leaves a float device parameter unrounded while riding 0 → 0.75', () => {
        // The complement, so the fix cannot be "round everything": Bacteria's
        // `mix` is declared `float` (step 0.01), and its slewed ride must still
        // land fractional values at the DSP.
        seedSteppedLane({ deviceId: 'device-b2', deviceType: 'bacteria', paramId: 'mix', startValue: 0 });

        ride({ startValue: 0, endValue: 0.75 });

        const delivered = vi.mocked(updateDeviceParam).mock.calls.map(([, , , value]) => value);

        expect(delivered.length).toBeGreaterThan(0);
        expect(delivered.some((value) => !Number.isInteger(value))).toBe(true);
    });
});
