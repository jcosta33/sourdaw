import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { updateDeviceParam, updateMidiFxParam } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { isRecordingAutomation } from '#/modules/Automation/useCases';
import { applyFermenterRuntimeParam } from '#/modules/Fermenter/useCases';

import { applyAutomation } from '../applyAutomation';
import { restoreAutomationBaseValue } from '../restoreAutomationBaseValue';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    const trackStore: { value: typeof mod.trackStore.value; subscribe: typeof mod.trackStore.subscribe } = {
        value: { tracks: [], selectedTrackId: null },
        subscribe: vi.fn<typeof mod.trackStore.subscribe>((_callback) => () => {}),
    };
    return {
        ...mod,
        trackStore,
        resolveEligibleDeviceWriteTarget: vi.fn(() => ({ status: 'missing' })),
    };
});
vi.mock('#/modules/Automation/stores', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/stores')>();
    return { ...mod, automationStore: { value: { lanes: [] } } };
});
vi.mock('#/modules/Automation/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Automation/useCases')>();
    return {
        ...mod,
        getAutomationValueAtBeat: vi.fn(() => 0.8),
        isRecordingAutomation: vi.fn(() => false),
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...mod,
        getCurrentTime: vi.fn(() => 5),
        getCompensationDelay: vi.fn(() => 0),
        updateDeviceParam: vi.fn(),
        updateMidiFxParam: vi.fn(),
    };
});
vi.mock('#/modules/Fermenter/useCases', async (importOriginal) => {
    const mod = await importOriginal<typeof import('#/modules/Fermenter/useCases')>();
    return { ...mod, applyFermenterRuntimeParam: vi.fn() };
});

type MutableTrackStore = { value: { tracks: unknown[] } };
type MutableAutomationStore = { value: { lanes: unknown[] } };
const mutableTrackStore = trackStore as unknown as MutableTrackStore;
const mutableAutomationStore = automationStore as unknown as MutableAutomationStore;

const FX = { id: 'arp-1', type: 'arp', bypassed: false, parameterValues: { rate: 0 } };
const FX_CLIP = { id: 'clip-fx', startBeat: 8, endBeat: 16 };

function seedMidiFxLane(parameterId: string, clipId?: string): void {
    mutableTrackStore.value = {
        tracks: [
            {
                id: 'track-1',
                kind: 'midi',
                automationMode: 'read',
                clips: clipId ? [FX_CLIP] : [],
                devices: [],
                midiFx: [FX],
                sends: [],
            },
        ],
    };
    mutableAutomationStore.value = {
        lanes: [
            {
                id: 'lane-fx',
                trackId: 'track-1',
                clipId,
                parameterId,
                minValue: 0,
                points: [{ beat: 0, value: 0.8 }],
            },
        ],
    };
}

/**
 * #4789 — MIDI-FX parameters reach no processing: no note-transform code reads
 * `track.midiFx` or the engine's `strip.midiFxNodes` mirror, so a curve driving
 * one has never been audible. Until a processor consumes those values, a
 * MIDI-FX parameter is not an automation target at all: the drive path must
 * write nothing and the base restore must write nothing, rather than feeding an
 * inert store and claiming the parameter is automated.
 */
describe('MIDI-FX parameters are not automation targets (#4789)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isRecordingAutomation).mockReturnValue(false);
    });

    it('drives nothing for a track-level MIDI-FX parameter lane', () => {
        seedMidiFxLane('rate');

        applyAutomation(0);
        applyAutomation(1);

        expect(updateMidiFxParam).not.toHaveBeenCalled();
        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(applyFermenterRuntimeParam).not.toHaveBeenCalled();
    });

    it('drives nothing for a clip-scoped MIDI-FX parameter lane inside its window', () => {
        seedMidiFxLane('rate', FX_CLIP.id);

        applyAutomation(9);

        expect(updateMidiFxParam).not.toHaveBeenCalled();
        expect(updateDeviceParam).not.toHaveBeenCalled();
    });

    it('does not rewrite the stored base when a MIDI-FX lane stops driving', () => {
        restoreAutomationBaseValue({
            lane: { trackId: 'track-1', parameterId: 'rate' },
            track: {
                gain: 0.4,
                pan: 12,
                devices: [],
                // The track carries the MIDI-FX holding the lane's parameter,
                // the way production truth does, so the refusal below observes
                // the keyed write a resurrected restore loop would make.
                midiFx: [{ id: 'arp-1', type: 'arp', parameterValues: { rate: 0.25 } }],
            },
            landTime: 7,
        });

        expect(updateMidiFxParam).not.toHaveBeenCalled();
    });
});
