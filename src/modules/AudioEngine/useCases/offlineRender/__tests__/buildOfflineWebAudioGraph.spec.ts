import { afterEach, describe, expect, it, vi } from 'vitest';

import { adjustmentLayerStore, type AdjustmentLayer, type Track } from '#/modules/Arrangement/stores';
import { defaultTransportState } from '#/modules/Transport/stores';
import { beatAtSecondsFromAnchor, projectPpqEndpoints, resolveTempoAtBeat } from '#/modules/Transport/useCases';

import { configureOfflineMidiEventProjection } from '../../configureOfflineMidiEventProjection';
import { configureOfflinePpqEndpointProjection } from '../../configureOfflinePpqEndpointProjection';
import { configureOfflineYeastMidiProcessing } from '../../configureOfflineYeastMidiProcessing';
import { buildOfflineWebAudioGraph } from '../buildOfflineWebAudioGraph';
import { captureOfflineRenderInput } from '../captureOfflineRenderInput';
import { createWebAudioOfflineBackend } from '../createWebAudioOfflineBackend';
import { type OfflineRenderProjectSource } from '../OfflineRenderSource';
import { resolveOfflineMixPlan } from '../resolveOfflineMixPlan';

function param(value = 0) {
    return { value, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
}

function node() {
    return { connect: vi.fn(), disconnect: vi.fn() };
}

// Local Track fixture: foreign test helpers have no public contract barrel.
const track: Track = {
    id: 'source',
    name: 'Source',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: '#fff',
    clips: [],
    devices: [],
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
    activeAlternativeId: 'alt',
    alternatives: [{ id: 'alt', name: 'Alternative', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    midiFx: [],
};

const project: OfflineRenderProjectSource = {
    tracks: { tracks: [track], selectedTrackId: null },
    midi: { probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
    transport: { ...defaultTransportState, tempo: 120 },
    tempoMap: null,
    timeSignatureMap: null,
    automationLanes: [],
    takeLanes: null,
    gainEnvelopes: {},
    sidechainRoutes: [],
    vcaGroups: [],
    grooveTemplates: null,
    chordTrack: null,
    yeastProcessorsByDevice: {},
};

const earlyLayer: AdjustmentLayer = {
    id: 'early',
    name: 'Early',
    effectType: 'volume',
    parameters: [{ name: 'Gain', value: -12, min: -24, max: 24, unit: 'dB' }],
    affectedTrackIds: [track.id],
    insertionIndex: 0,
    regions: [{ id: 'early-region', startBeat: 0, endBeat: 4, blend: 1, fadeInBeats: 0, fadeOutBeats: 4 }],
    enabled: true,
    mix: 1,
    color: '#fff',
};

function context() {
    return {
        currentTime: 0,
        createGain: () => ({ ...node(), gain: param(1) }),
        createStereoPanner: () => ({ ...node(), pan: param(0) }),
        createBiquadFilter: vi.fn(() => ({
            ...node(),
            type: 'lowpass',
            frequency: param(),
            Q: param(),
            gain: param(),
        })),
    };
}

describe('buildOfflineWebAudioGraph adjustment layer independence', () => {
    afterEach(() => {
        adjustmentLayerStore.set({ layers: [] });
    });

    it.each([false, true])('preserves steady DSP beside mixer movement and moving DSP=%s', async (movingDsp) => {
        configureOfflinePpqEndpointProjection({
            project: projectPpqEndpoints,
            resolveTempoAtBeat,
            beatAtSecondsFromAnchor,
        });
        configureOfflineMidiEventProjection({
            createProjector: () => (input) => input.events,
            selectProbability: () => true,
            createChordPitchProjector: () => (input) => input.pitch,
            evaluateAutomationValue: () => 0,
        });
        configureOfflineYeastMidiProcessing({ createProcessor: () => () => [] });
        const firstEq: AdjustmentLayer = {
            ...earlyLayer,
            id: 'first-eq',
            effectType: 'eq',
            regions: [],
            parameters: [{ name: 'Low Gain', value: 6, min: -24, max: 24, unit: 'dB' }],
        };
        const secondEq: AdjustmentLayer = {
            ...firstEq,
            id: 'second-eq',
            parameters: [{ name: 'High Gain', value: -4, min: -24, max: 24, unit: 'dB' }],
        };
        const movingFilter: AdjustmentLayer = { ...earlyLayer, id: 'moving-filter', effectType: 'filter' };
        adjustmentLayerStore.set({
            layers: movingDsp ? [earlyLayer, firstEq, movingFilter, secondEq] : [earlyLayer, firstEq, secondEq],
        });
        const input = captureOfflineRenderInput({ durationBeats: 8 }, { project });
        const plan = resolveOfflineMixPlan(input);
        expect(plan.allRenderableTracks.map((renderTrack) => renderTrack.id)).toEqual([track.id]);
        const ctx = context();
        const offlineCtx = ctx as unknown as OfflineAudioContext;
        const master = node();
        const backend = createWebAudioOfflineBackend({
            context: offlineCtx,
            masterNode: master as unknown as AudioNode,
        });
        const onWarning = vi.fn();
        try {
            const graph = await buildOfflineWebAudioGraph({
                input,
                plan,
                offlineCtx,
                backend,
                masterNode: master as unknown as AudioNode,
                onWarning,
            });
            const filters = ctx.createBiquadFilter.mock.results.map(({ value }) => value);
            expect(filters).toHaveLength(6);
            expect(filters.map((filter) => filter.gain.value)).toEqual([6, 0, 0, 0, 0, -4]);
            const strip = graph.trackStripsById.get(track.id)!;
            expect(strip.outputNode.disconnect).toHaveBeenCalledWith(master);
            const firstBusInput = vi.mocked(strip.outputNode.connect).mock.calls.at(-1)![0] as unknown as ReturnType<
                typeof node
            >;
            expect(firstBusInput.connect).toHaveBeenCalledWith(filters[0]);
            const firstWet = filters[2]!.connect.mock.calls[0]![0] as ReturnType<typeof node>;
            const firstOutput = firstWet.connect.mock.calls[0]![0] as ReturnType<typeof node>;
            const secondBusInput = firstOutput.connect.mock.calls[0]![0] as ReturnType<typeof node>;
            expect(secondBusInput.connect).toHaveBeenCalledWith(filters[3]);
            const secondWet = filters[5]!.connect.mock.calls[0]![0] as ReturnType<typeof node>;
            const secondOutput = secondWet.connect.mock.calls[0]![0] as ReturnType<typeof node>;
            expect(secondOutput.connect).toHaveBeenCalledWith(master);
            if (movingDsp) {
                expect(onWarning).toHaveBeenCalledExactlyOnceWith(
                    'A DSP adjustment layer that fades across this export is skipped; only steady layers render offline.'
                );
            } else {
                expect(onWarning).not.toHaveBeenCalled();
            }
        } finally {
            backend.dispose();
        }
    });
});
