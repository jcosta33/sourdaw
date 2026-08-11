import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { getGlutenState, glutenMeterStore, glutenStore } from '../../../stores/glutenStore';
import { hydrateGlutenPatchFromProject } from '../../../useCases/glutenParamBridge/hydrateGlutenPatchFromProject';
import { GlutenPanel } from '../GlutenPanel';

const DEVICE_ID = 'gluten-project-device';

function glutenTrack(parameterValues: Record<string, number>): Track {
    return {
        ...createTrack({ id: 'track-1', name: 'Drum bus', kind: 'audio' }),
        devices: [{ id: DEVICE_ID, name: 'Gluten', type: 'gluten', bypassed: false, parameterValues }],
    };
}

describe('GlutenPanel project hydration', () => {
    beforeEach(() => {
        glutenStore.set({});
        glutenMeterStore.set({});
        trackStore.set({
            tracks: [
                glutenTrack({
                    topology: 3,
                    ratio: 20,
                    attack: 0.02,
                    oversampling: 3,
                    recovery: 4.9,
                    vcaType: 1.9,
                    mix: 2,
                }),
            ],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
    });

    it('derives topology-specific travel from the project value replayed by the engine', async () => {
        render(<GlutenPanel deviceId={DEVICE_ID} />);

        const ratio = await screen.findByRole('slider', { name: 'Ratio' });
        const attack = screen.getByRole('slider', { name: 'Attack' });

        expect(ratio.getAttribute('aria-valuemax')).toBe('6');
        expect(attack.getAttribute('aria-valuemin')).toBe('0.5');
        expect(getGlutenState(DEVICE_ID).patch.oversampling).toBe(2);
        expect(getGlutenState(DEVICE_ID).patch.recovery).toBe(4);
        expect(getGlutenState(DEVICE_ID).patch.vcaType).toBe(1);
        expect(getGlutenState(DEVICE_ID).patch.mix).toBe(1);

        act(() => {
            trackStore.set({
                tracks: [glutenTrack({ topology: 0, ratio: 20, attack: 250 })],
                selectedTrackId: 'track-1',
                ghostClips: [],
            });
        });

        await waitFor(() => expect(ratio.getAttribute('aria-valuemax')).toBe('20'));
        expect(attack.getAttribute('aria-valuemax')).toBe('250');
    });

    it('matches Rust truncation before resolving a fractional oversampling wire value', () => {
        trackStore.set({
            tracks: [glutenTrack({ oversampling: 1.9 })],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });

        hydrateGlutenPatchFromProject(DEVICE_ID);

        expect(getGlutenState(DEVICE_ID).patch.oversampling).toBe(1);
    });
});
