import { describe, expect, it } from 'vitest';

import { type ProjectContext } from '../../../models/ProjectContext';
import { bridgeGroundedLlmToolCalls } from '../bridgeGroundedLlmToolCalls';

type ProjectTrack = ProjectContext['tracks'][number];
type CreateTrackInput = {
    id: string;
    name: string;
    kind?: ProjectTrack['kind'];
    devices?: ProjectTrack['devices'];
};

function createTrack({ id, name, kind = 'audio', devices = [] }: CreateTrackInput): ProjectTrack {
    return {
        id,
        name,
        kind,
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        outputId: kind === 'master' ? 'hw_out' : 'master',
        clipCount: 0,
        deviceCount: devices.length,
        clips: [],
        devices,
        sends: [],
    };
}

const vocals = createTrack({
    id: 'track-vocals',
    name: 'Vocals',
    devices: [{ id: 'device-eq', type: 'EQ', bypassed: false, parameters: [] }],
});
const guitar = createTrack({ id: 'track-guitar', name: 'Guitar' });
const master = createTrack({ id: 'master', name: 'Master', kind: 'master' });
const projectContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    tracks: [vocals, guitar, master],
    selectedTrackId: 'track-vocals',
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'mix',
    playheadPosition: 0,
};

function bridge(
    calls: Parameters<typeof bridgeGroundedLlmToolCalls>[0]['calls'],
    prompt: string,
    context = projectContext
) {
    return bridgeGroundedLlmToolCalls({ calls, prompt, context });
}

describe('bridgeGroundedLlmToolCalls', () => {
    it('grounds multiple distinct targets from one provider plan', () => {
        const result = bridge(
            [
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'setTrackPan', arguments: { trackId: 'track-guitar', pan: -20 } },
            ],
            'mute Vocals and pan Guitar'
        );
        const swapped = bridge(
            [
                { name: 'muteTrack', arguments: { trackId: 'track-guitar', muted: true } },
                { name: 'setTrackPan', arguments: { trackId: 'track-vocals', pan: -20 } },
            ],
            'mute Vocals and pan Guitar'
        );
        const repeated = bridge(
            [
                { name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } },
                { name: 'muteTrack', arguments: { trackId: 'track-guitar', muted: true } },
            ],
            'mute Vocals and mute Guitar'
        );

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: -20 } },
        ]);
        expect(result.rejections).toEqual([]);
        expect(swapped.actions).toEqual([]);
        expect(repeated.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
            { type: 'muteTrack', payload: { trackId: 'track-guitar', muted: true } },
        ]);
    });

    it('rejects ambiguous, mismatched, and ungrounded provider targets', () => {
        const ambiguousContext = {
            ...projectContext,
            tracks: [...projectContext.tracks, { ...vocals, id: 'track-vocals-double' }],
        };
        const ambiguous = bridge(
            [{ name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } }],
            'mute Vocals',
            ambiguousContext
        );
        const mismatched = bridge(
            [{ name: 'muteTrack', arguments: { trackId: 'track-guitar', muted: true } }],
            'mute Vocals'
        );
        const ungrounded = bridge(
            [{ name: 'muteTrack', arguments: { trackId: 'track-vocals', muted: true } }],
            'make it quieter'
        );
        const wrongAction = bridge(
            [{ name: 'soloTrack', arguments: { trackId: 'track-vocals', soloed: true } }],
            'mute Vocals'
        );
        const center = createTrack({ id: 'track-center', name: 'Center' });
        const entityActionCollision = bridge(
            [{ name: 'setTrackPan', arguments: { trackId: center.id, pan: 0 } }],
            'mute Center',
            { ...projectContext, tracks: [...projectContext.tracks, center] }
        );

        expect(ambiguous.rejections[0]?.reason).toContain('ambiguous');
        expect(mismatched.rejections[0]?.reason).toContain('does not match');
        expect(ungrounded.rejections[0]?.reason).toContain('not grounded');
        expect(wrongAction.actions).toEqual([]);
        expect(entityActionCollision.actions).toEqual([]);
    });

    it('grounds targetless intent, discrete polarity, and literal rename values', () => {
        const valid = bridge(
            [
                { name: 'setTempo', arguments: { bpm: 128 } },
                { name: 'muteTrack', arguments: { trackId: vocals.id, muted: false } },
                { name: 'renameTrack', arguments: { trackId: guitar.id, name: 'Solo' } },
            ],
            'set tempo to 128 and unmute Vocals and rename Guitar to Solo'
        );
        const hallucinatedTargetless = bridge(
            [{ name: 'addTrack', arguments: { name: 'Drums', kind: 'audio' } }],
            'mute Vocals'
        );
        const negated = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'do not mute Vocals'
        );
        const wrongPolarity = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'unmute Vocals'
        );
        const wrongRename = bridge(
            [{ name: 'renameTrack', arguments: { trackId: vocals.id, name: 'Drums' } }],
            'rename Vocals to Lead'
        );
        const specificIntent = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.7 } }],
            'increase volume to 70% on Vocals'
        );
        const wrongTempo = bridge([{ name: 'setTempo', arguments: { bpm: 300 } }], 'set tempo to 120');
        const wrongColor = bridge(
            [{ name: 'setTrackColor', arguments: { trackId: vocals.id, color: '#ff0000' } }],
            'color Vocals #00ff00'
        );
        const wrongCreatedTrack = bridge(
            [{ name: 'addTrack', arguments: { name: 'Bass', kind: 'midi' } }],
            'create an audio track named Drums'
        );

        expect(valid.actions).toEqual([
            { type: 'setTempo', payload: { bpm: 128 } },
            { type: 'muteTrack', payload: { trackId: vocals.id, muted: false } },
            { type: 'renameTrack', payload: { trackId: guitar.id, name: 'Solo' } },
        ]);
        expect(hallucinatedTargetless.actions).toEqual([]);
        expect(negated.actions).toEqual([]);
        expect(wrongPolarity.actions).toEqual([]);
        expect(wrongRename.actions).toEqual([]);
        expect(specificIntent.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, gain: 0.7 } }]);
        expect(wrongTempo.actions).toEqual([]);
        expect(wrongColor.actions).toEqual([]);
        expect(wrongCreatedTrack.actions).toEqual([]);
    });

    it('rejects masked-control bypasses, broad creation verbs, and qualitative direction mismatches', () => {
        const referenceCollisionContext = {
            ...projectContext,
            tracks: [
                ...projectContext.tracks,
                createTrack({ id: 'track-not', name: 'Not' }),
                createTrack({ id: 'track-120', name: '120' }),
            ],
        };
        const negatedTempo = bridge(
            [{ name: 'setTempo', arguments: { bpm: 120 } }],
            'do not set tempo to 120',
            referenceCollisionContext
        );
        const wrongTempo = bridge(
            [{ name: 'setTempo', arguments: { bpm: 300 } }],
            'set tempo to 120',
            referenceCollisionContext
        );
        const broadCreation = bridge(
            [{ name: 'addTrack', arguments: { name: 'Reverb', kind: 'audio' } }],
            'add reverb to Vocals'
        );
        const wrongGainDirection = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 1 } }],
            'make Vocals quieter'
        );
        const validGainDirection = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.7 } }],
            'make Vocals quieter'
        );
        const wrongPanDirection = bridge(
            [{ name: 'setTrackPan', arguments: { trackId: guitar.id, pan: 50 } }],
            'pan Guitar left'
        );
        const explanatoryQuestion = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'Why did you mute Vocals?'
        );
        const hypothetical = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'If you mute Vocals, the mix changes'
        );
        const quoted = bridge([{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }], '"mute Vocals"');
        const politeCommand = bridge(
            [{ name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } }],
            'Could you mute Vocals?'
        );
        const wrongFinalGain = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.02 } }],
            'lower Vocals from 80% to 60% over 2 bars'
        );
        const validFinalGain = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: vocals.id, gain: 0.6 } }],
            'lower Vocals from 80% to 60% over 2 bars'
        );

        expect(negatedTempo.actions).toEqual([]);
        expect(wrongTempo.actions).toEqual([]);
        expect(broadCreation.actions).toEqual([]);
        expect(wrongGainDirection.actions).toEqual([]);
        expect(validGainDirection.actions).toEqual([
            { type: 'setTrackGain', payload: { trackId: vocals.id, gain: 0.7 } },
        ]);
        expect(wrongPanDirection.actions).toEqual([]);
        expect(explanatoryQuestion.actions).toEqual([]);
        expect(hypothetical.actions).toEqual([]);
        expect(quoted.actions).toEqual([]);
        expect(politeCommand.actions).toEqual([{ type: 'muteTrack', payload: { trackId: vocals.id, muted: true } }]);
        expect(wrongFinalGain.actions).toEqual([]);
        expect(validFinalGain.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: vocals.id, gain: 0.6 } }]);
    });

    it('segments sentence-ending periods after numeric values', () => {
        const result = bridge(
            [
                { name: 'setTempo', arguments: { bpm: 120 } },
                { name: 'muteTrack', arguments: { trackId: vocals.id, muted: true } },
            ],
            'set tempo to 120. Mute Vocals.'
        );

        expect(result.actions).toEqual([
            { type: 'setTempo', payload: { bpm: 120 } },
            { type: 'muteTrack', payload: { trackId: vocals.id, muted: true } },
        ]);
    });

    it('binds selected-track references and rejects device fallback without a selection', () => {
        const selected = bridge(
            [{ name: 'setTrackGain', arguments: { trackId: 'track-vocals', gain: 0.6 } }],
            'turn down the selected track'
        );
        const withoutSelection = bridge(
            [{ name: 'bypassDevice', arguments: { deviceId: 'device-eq', bypassed: true } }],
            'bypass EQ on the selected track',
            { ...projectContext, selectedTrackId: null }
        );
        const distractor = createTrack({ id: 'track-distractor', name: 'Track' });
        const wrongSelection = bridge(
            [{ name: 'muteTrack', arguments: { trackId: distractor.id, muted: true } }],
            'mute the selected track',
            { ...projectContext, tracks: [...projectContext.tracks, distractor] }
        );

        expect(selected.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 'track-vocals', gain: 0.6 } }]);
        expect(withoutSelection.actions).toEqual([]);
        expect(wrongSelection.actions).toEqual([]);
    });

    it('scopes duplicate device names to a uniquely referenced owner track', () => {
        const frequency = {
            id: 'frequency',
            name: 'Frequency',
            type: 'float' as const,
            value: 1200,
            minValue: 20,
            maxValue: 20_000,
            unit: 'Hz',
        };
        const scopedContext: ProjectContext = {
            ...projectContext,
            tracks: projectContext.tracks.map((track) => {
                if (track.id === 'track-vocals') {
                    return { ...track, devices: [{ ...track.devices[0]!, parameters: [frequency] }] };
                }
                if (track.id === 'track-guitar') {
                    return {
                        ...track,
                        deviceCount: 1,
                        devices: [{ id: 'device-eq-guitar', type: 'EQ', bypassed: false, parameters: [frequency] }],
                    };
                }
                return track;
            }),
        };
        const bypass = bridge(
            [{ name: 'bypassDevice', arguments: { deviceId: 'device-eq', bypassed: true } }],
            'bypass EQ on Vocals',
            scopedContext
        );
        const parameter = bridge(
            [{ name: 'setDeviceParameter', arguments: { deviceId: 'device-eq', paramId: 'frequency', value: 2400 } }],
            'set EQ Frequency on Vocals',
            scopedContext
        );
        const wrongParameterDirection = bridge(
            [{ name: 'setDeviceParameter', arguments: { deviceId: 'device-eq', paramId: 'frequency', value: 1000 } }],
            'increase EQ Frequency on Vocals',
            scopedContext
        );
        const validParameterDirection = bridge(
            [{ name: 'setDeviceParameter', arguments: { deviceId: 'device-eq', paramId: 'frequency', value: 2400 } }],
            'increase EQ Frequency on Vocals',
            scopedContext
        );
        const mix = { ...frequency, id: 'mix', name: 'Mix', value: 0.5, minValue: 0, maxValue: 1, unit: '' };
        const mixTrack = createTrack({ id: 'track-mix', name: 'Mix' });
        const ownerCollisionContext: ProjectContext = {
            ...scopedContext,
            tracks: [
                ...scopedContext.tracks.map((track) => {
                    if (track.id !== vocals.id) {
                        return track;
                    }
                    return { ...track, devices: [{ ...track.devices[0]!, parameters: [frequency, mix] }] };
                }),
                mixTrack,
            ],
        };
        const ownerCollision = bridge(
            [{ name: 'setDeviceParameter', arguments: { deviceId: 'device-eq', paramId: 'mix', value: 0.5 } }],
            'set EQ Mix on Vocals',
            ownerCollisionContext
        );
        const ambiguousOwnerContext: ProjectContext = {
            ...projectContext,
            tracks: [
                { ...vocals, devices: [], deviceCount: 0 },
                { ...vocals, id: 'track-vocals-double', devices: [], deviceCount: 0 },
                {
                    ...guitar,
                    deviceCount: 1,
                    devices: [
                        {
                            id: 'device-eq-guitar',
                            type: 'EQ',
                            bypassed: false,
                            parameters: [frequency],
                        },
                    ],
                },
                master,
            ],
        };
        const wrongOwner = bridge(
            [{ name: 'bypassDevice', arguments: { deviceId: 'device-eq-guitar', bypassed: true } }],
            'bypass EQ on Vocals',
            ambiguousOwnerContext
        );

        expect(bypass.actions).toEqual([{ type: 'bypassDevice', payload: { deviceId: 'device-eq', bypassed: true } }]);
        expect(parameter.actions).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'device-eq', paramId: 'frequency', value: 2400 } },
        ]);
        expect(wrongParameterDirection.actions).toEqual([]);
        expect(validParameterDirection.actions).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'device-eq', paramId: 'frequency', value: 2400 } },
        ]);
        expect(ownerCollision.actions).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'device-eq', paramId: 'mix', value: 0.5 } },
        ]);
        expect(wrongOwner.actions).toEqual([]);
    });

    it('reports an exact distinct-target rejection for same-endpoint routing', () => {
        const bus = createTrack({ id: 'bus-reverb', name: 'Reverb Bus', kind: 'bus' });
        const result = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: bus.id, outputId: bus.id } }],
            'route Reverb Bus to Reverb Bus',
            { ...projectContext, tracks: [...projectContext.tracks, bus] }
        );
        const drumBus = createTrack({ id: 'bus-drums', name: 'Drum Bus', kind: 'bus' });
        const reversed = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: bus.id, outputId: drumBus.id } }],
            'route Drum Bus to Reverb Bus',
            { ...projectContext, tracks: [...projectContext.tracks, bus, drumBus] }
        );
        const directionless = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: drumBus.id, outputId: bus.id } }],
            'route Drum Bus Reverb Bus',
            { ...projectContext, tracks: [...projectContext.tracks, bus, drumBus] }
        );

        expect(result.rejections[0]?.reason).toBe('Target trackId must be distinct from outputId');
        expect(reversed.actions).toEqual([]);
        expect(directionless.actions).toEqual([]);
    });

    it('preserves conjunctions and routing prepositions inside project names', () => {
        const drumsAndBass = createTrack({ id: 'track-drums-bass', name: 'Drums and Bass' });
        const backToBlack = createTrack({ id: 'track-back-black', name: 'Back to Black' });
        const context = {
            ...projectContext,
            tracks: [...projectContext.tracks, drumsAndBass, backToBlack],
        };
        const mute = bridge(
            [{ name: 'muteTrack', arguments: { trackId: drumsAndBass.id, muted: true } }],
            'mute Drums and Bass',
            context
        );
        const route = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: backToBlack.id, outputId: master.id } }],
            'route Back to Black to Master',
            context
        );

        expect(mute.actions).toEqual([{ type: 'muteTrack', payload: { trackId: drumsAndBass.id, muted: true } }]);
        expect(route.actions).toEqual([
            {
                type: 'setTrackOutput',
                payload: { trackId: backToBlack.id, outputId: master.id, expectedOutputId: master.id },
            },
        ]);
    });

    it('segments sentences and ignores negation words inside project names', () => {
        const neverEnough = createTrack({ id: 'track-never-enough', name: 'Never Enough' });
        const whyNot = createTrack({ id: 'track-why-not', name: 'Why Not' });
        const context = {
            ...projectContext,
            tracks: [...projectContext.tracks, neverEnough, whyNot],
        };
        const result = bridge(
            [
                { name: 'muteTrack', arguments: { trackId: neverEnough.id, muted: true } },
                { name: 'soloTrack', arguments: { trackId: whyNot.id, soloed: true } },
                { name: 'setTrackPan', arguments: { trackId: guitar.id, pan: -20 } },
            ],
            'Mute Never Enough.\n- Solo Why Not.\nPan Guitar 20 left.',
            context
        );

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: neverEnough.id, muted: true } },
            { type: 'soloTrack', payload: { trackId: whyNot.id, soloed: true } },
            { type: 'setTrackPan', payload: { trackId: guitar.id, pan: -20 } },
        ]);
    });

    it('requires Master to be phrased as an output target', () => {
        const homonym = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: 'track-vocals', outputId: 'master' } }],
            'master Vocals'
        );
        const explicit = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: 'track-vocals', outputId: 'master' } }],
            'route Vocals to Master'
        );

        expect(homonym.actions).toEqual([]);
        expect(explicit.actions).toEqual([
            {
                type: 'setTrackOutput',
                payload: { trackId: 'track-vocals', outputId: 'master', expectedOutputId: 'master' },
            },
        ]);
    });

    it('rejects oversized batches before reading project targets', () => {
        const unreadContext: ProjectContext = {
            ...projectContext,
            get tracks(): ProjectContext['tracks'] {
                throw new Error('Oversized batches must not read project targets');
            },
        };
        const result = bridge(
            Array.from({ length: 25 }, () => ({
                name: 'muteTrack',
                arguments: { trackId: 'track-vocals', muted: true },
            })),
            'mute Vocals',
            unreadContext
        );

        expect(result.rejections).toEqual([
            { index: 24, name: '<batch>', reason: 'Provider batch exceeds the 24-action limit' },
        ]);
    });
});
