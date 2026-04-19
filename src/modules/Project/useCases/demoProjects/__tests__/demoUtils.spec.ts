import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { defaultArrangementId } from '../../../stores/arrangementStore';
import { applyPreset } from '../demoUtils/applyPreset';
import { syncArrangement } from '../demoUtils/syncArrangement';
import { getFactoryPresets } from '#/modules/Arrangement/useCases';
import { arrangementStore } from '../../../stores/arrangementStore';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { markerStore } from '#/modules/Arrangement/stores';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getFactoryPresets: vi.fn(),
}));

vi.mock('../../../stores/arrangementStore', () => ({
    arrangementStore: { set: vi.fn(), value: null },
    defaultArrangementId: 'default-arrangement-id',
}));

vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { value: { lanes: [] }, set: vi.fn() },
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        set: vi.fn(),
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    markerStore: { value: { markers: [], sections: [] }, set: vi.fn() },
}));

describe('applyPreset', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('copies devices when preset id matches', () => {
        vi.mocked(getFactoryPresets).mockReturnValue([
            {
                id: 'preset-a',
                devices: [
                    {
                        name: 'Synth',
                        type: 'synth',
                        parameterValues: { gain: 0.8 },
                    },
                ],
            } as any,
        ]);
        const track: { devices?: unknown[] } = {};
        applyPreset(track, 'preset-a');
        expect(track.devices).toHaveLength(1);
        expect(track.devices![0]).toMatchObject({
            name: 'Synth',
            type: 'synth',
            bypassed: false,
            parameterValues: { gain: 0.8 },
        });
    });
});

describe('syncArrangement', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('writes arrangement snapshot from current store values', () => {
        const set = vi.mocked(arrangementStore.set);
        syncArrangement([{ id: 'tr1' }]);
        expect(set).toHaveBeenCalledTimes(1);
        const payload = set.mock.calls[0]![0] as {
            arrangements: Array<{ tracks: { tracks: unknown[]; selectedTrackId: string | null } }>;
        };
        expect(payload.arrangements[0]!.tracks.tracks).toEqual([{ id: 'tr1' }]);
        expect(payload.arrangements[0]!.tracks.selectedTrackId).toBe('tr1');
    });
});

