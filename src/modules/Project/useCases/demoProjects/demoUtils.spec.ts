import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { defaultArrangementId } from '../../stores/arrangementStore';
import { applyPreset } from './demoUtils/applyPreset';
import { syncArrangement } from './demoUtils/syncArrangement';

describe('applyPreset', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('copies devices when preset id matches', () => {
        const getFactoryPresets = vi.fn(() => [
            {
                id: 'preset-a',
                devices: [
                    {
                        name: 'Synth',
                        type: 'synth',
                        parameterValues: { gain: 0.8 },
                    },
                ],
            },
        ]);
        injectDependencies(applyPreset, {
            getFactoryPresets,
        });
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
    });

    it('writes arrangement snapshot from current store values', () => {
        const set = vi.fn();
        injectDependencies(syncArrangement, {
            arrangementStore: { set, value: null } as never,
            defaultArrangementId,
            automationStore: { value: { lanes: [] }, set: vi.fn() } as never,
            midiStore: {
                value: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                set: vi.fn(),
            } as never,
            markerStore: { value: { markers: [], sections: [] }, set: vi.fn() } as never,
        });
        syncArrangement([{ id: 'tr1' }]);
        expect(set).toHaveBeenCalledTimes(1);
        const payload = set.mock.calls[0]![0] as {
            arrangements: Array<{ tracks: { tracks: unknown[]; selectedTrackId: string | null } }>;
        };
        expect(payload.arrangements[0]!.tracks.tracks).toEqual([{ id: 'tr1' }]);
        expect(payload.arrangements[0]!.tracks.selectedTrackId).toBe('tr1');
    });
});
