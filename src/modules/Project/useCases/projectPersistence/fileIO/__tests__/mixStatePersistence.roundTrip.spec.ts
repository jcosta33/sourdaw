import { beforeEach, describe, expect, it, vi } from 'vitest';

import { gainEnvelopeStore, vcaGroupStore } from '#/modules/Arrangement/stores';
import { modulationStore } from '#/modules/Automation/stores';
import { cvGateStore, defaultCvGateState } from '#/modules/CvGate/stores';

import { hydrateModuleStoresFromProjectData } from '../../helpers/hydrateModuleStoresFromProjectData';
import { isHydratableProjectData } from '../../helpers/isHydratableProjectData';
import { buildProjectData } from '../buildProjectData';

vi.mock('../../../arrangement/syncCurrentArrangementToStore', () => ({
    syncCurrentArrangementToStore: vi.fn(),
}));

/** −6 dB expressed as the linear multiplier the VCA master actually applies. */
const MINUS_SIX_DB_GAIN = 10 ** (-6 / 20);

/**
 * Serialize the live stores, cross the real JSON file boundary, wipe the live
 * stores the way a project switch does, then load the file back. Anything that
 * does not survive this returns as a module default — which for a VCA master is
 * unity, i.e. the whole submix comes back louder than it was saved.
 */
async function roundTripLiveProject(): Promise<void> {
    const built = await buildProjectData();
    if (!built) {
        throw new Error('expected buildProjectData to produce a snapshot');
    }

    const onDisk: unknown = JSON.parse(JSON.stringify(built.data));

    vcaGroupStore.set({ groups: [] });
    gainEnvelopeStore.set({ envelopes: {} });
    modulationStore.set({ modulators: [] });
    cvGateStore.set(defaultCvGateState);

    if (!isHydratableProjectData(onDisk)) {
        throw new Error('the snapshot this build just wrote was rejected by its own import validator');
    }

    hydrateModuleStoresFromProjectData(onDisk);
}

describe('mix state save/load round-trip', () => {
    beforeEach(() => {
        vcaGroupStore.set({ groups: [] });
        gainEnvelopeStore.set({ envelopes: {} });
        modulationStore.set({ modulators: [] });
        cvGateStore.set(defaultCvGateState);
    });

    it('returns a VCA group faded to -6 dB at -6 dB, not at unity', async () => {
        vcaGroupStore.set({
            groups: [
                {
                    id: 'vca-drums',
                    name: 'Drums',
                    gain: MINUS_SIX_DB_GAIN,
                    muted: false,
                    trackIds: ['track-kick', 'track-snare'],
                },
            ],
        });

        await roundTripLiveProject();

        expect(vcaGroupStore.value?.groups).toEqual([
            {
                id: 'vca-drums',
                name: 'Drums',
                gain: MINUS_SIX_DB_GAIN,
                muted: false,
                trackIds: ['track-kick', 'track-snare'],
            },
        ]);
    });

    it('returns a muted VCA group still muted', async () => {
        vcaGroupStore.set({
            groups: [{ id: 'vca-fx', name: 'FX', gain: 0.25, muted: true, trackIds: ['track-verb'] }],
        });

        await roundTripLiveProject();

        expect(vcaGroupStore.value?.groups[0]?.muted).toBe(true);
        expect(vcaGroupStore.value?.groups[0]?.gain).toBe(0.25);
    });

    it('returns a clip gain envelope with its points and enabled flag', async () => {
        gainEnvelopeStore.set({
            envelopes: {
                'clip-vox': {
                    clipId: 'clip-vox',
                    enabled: true,
                    points: [
                        { id: 'point-a', beatOffset: 0, gainDb: 0 },
                        { id: 'point-b', beatOffset: 4, gainDb: -9.5 },
                    ],
                },
            },
        });

        await roundTripLiveProject();

        expect(vcaGroupStore.value?.groups).toEqual([]);
        expect(gainEnvelopeStore.value?.envelopes['clip-vox']).toEqual({
            clipId: 'clip-vox',
            enabled: true,
            points: [
                { id: 'point-a', beatOffset: 0, gainDb: 0 },
                { id: 'point-b', beatOffset: 4, gainDb: -9.5 },
            ],
        });
    });

    it('returns a modulator with its config and mappings', async () => {
        modulationStore.set({
            modulators: [
                {
                    id: 'mod-1',
                    name: 'Filter LFO',
                    trackId: 'track-bass',
                    kind: 'lfo',
                    config: { kind: 'lfo', waveform: 'triangle', rate: 0.5, sync: true, phase: 0.25, depth: 0.8 },
                    mappings: [
                        {
                            targetTrackId: 'track-bass',
                            targetDeviceId: 'device-filter',
                            targetParamId: 'cutoff',
                            amount: -0.6,
                        },
                    ],
                    enabled: true,
                },
            ],
        });

        await roundTripLiveProject();

        const modulator = modulationStore.value?.modulators[0];
        expect(modulator?.config).toEqual({
            kind: 'lfo',
            waveform: 'triangle',
            rate: 0.5,
            sync: true,
            phase: 0.25,
            depth: 0.8,
        });
        expect(modulator?.mappings).toEqual([
            { targetTrackId: 'track-bass', targetDeviceId: 'device-filter', targetParamId: 'cutoff', amount: -0.6 },
        ]);
    });

    it('returns CV/gate outputs and the voltage standard they were saved with', async () => {
        cvGateStore.set({
            ...defaultCvGateState,
            voltageStandard: 'hz-per-volt',
            clockDivision: 4,
            outputs: [
                {
                    id: 'cv-pitch-1',
                    name: 'Pitch',
                    outputChannel: 2,
                    type: 'cv-pitch',
                    minVoltage: -2,
                    maxVoltage: 8,
                    value: 1.5,
                    active: true,
                },
            ],
        });

        await roundTripLiveProject();

        expect(cvGateStore.value?.voltageStandard).toBe('hz-per-volt');
        expect(cvGateStore.value?.clockDivision).toBe(4);
        expect(cvGateStore.value?.outputs).toEqual([
            {
                id: 'cv-pitch-1',
                name: 'Pitch',
                outputChannel: 2,
                type: 'cv-pitch',
                minVoltage: -2,
                maxVoltage: 8,
                value: 1.5,
                active: true,
            },
        ]);
    });
});
