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

        expect(result.actions).toEqual([
            { type: 'muteTrack', payload: { trackId: 'track-vocals', muted: true } },
            { type: 'setTrackPan', payload: { trackId: 'track-guitar', pan: -20 } },
        ]);
        expect(result.rejections).toEqual([]);
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

        expect(ambiguous.rejections[0]?.reason).toContain('ambiguous');
        expect(mismatched.rejections[0]?.reason).toContain('does not match');
        expect(ungrounded.rejections[0]?.reason).toContain('not grounded');
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

        expect(selected.actions).toEqual([{ type: 'setTrackGain', payload: { trackId: 'track-vocals', gain: 0.6 } }]);
        expect(withoutSelection.actions).toEqual([]);
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

        expect(bypass.actions).toEqual([{ type: 'bypassDevice', payload: { deviceId: 'device-eq', bypassed: true } }]);
        expect(parameter.actions).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'device-eq', paramId: 'frequency', value: 2400 } },
        ]);
    });

    it('reports an exact distinct-target rejection for same-endpoint routing', () => {
        const bus = createTrack({ id: 'bus-reverb', name: 'Reverb Bus', kind: 'bus' });
        const result = bridge(
            [{ name: 'setTrackOutput', arguments: { trackId: bus.id, outputId: bus.id } }],
            'route Reverb Bus to Reverb Bus',
            { ...projectContext, tracks: [...projectContext.tracks, bus] }
        );

        expect(result.rejections[0]?.reason).toBe('Target trackId must be distinct from outputId');
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
