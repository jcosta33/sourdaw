import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Track, trackStore } from '#/modules/Arrangement/stores';

import { getGlutenState, glutenMeterStore, glutenStore } from '../../../stores/glutenStore';
import { hydrateGlutenPatchFromProject } from '../../../useCases/glutenParamBridge/hydrateGlutenPatchFromProject';
import { GlutenPanel } from '../GlutenPanel';

const DEVICE_ID = 'gluten-project-device';

function glutenTrack(parameterValues: Record<string, number>): Track {
    return {
        id: 'track-1',
        name: 'Drum bus',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ffff',
        clips: [],
        devices: [{ id: DEVICE_ID, name: 'Gluten', type: 'gluten', bypassed: false, parameterValues }],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiFx: [],
        midiOutputTrackId: null,
        followChordTrack: false,
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
