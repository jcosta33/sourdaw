import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Dso } from '../../../models/DsoTypes';
import { validateDsos } from '../validateDsos';

const mocks = vi.hoisted(() => {
    const trackStoreValue: { value: unknown } = { value: null };
    return { trackStoreValue };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

type TrackFixture = { id: string; clipIds?: string[]; deviceIds?: string[] };

function trackState(tracks: TrackFixture[]) {
    return {
        tracks: tracks.map((track) => ({
            id: track.id,
            clips: (track.clipIds ?? []).map((id) => ({ id })),
            devices: (track.deviceIds ?? []).map((id) => ({ id })),
        })),
    };
}

describe('validateDsos', () => {
    beforeEach(() => {
        mocks.trackStoreValue.value = trackState([{ id: 'track-1', clipIds: ['clip-1'], deviceIds: ['device-1'] }]);
    });

    it('returns no errors for an empty DSO list', () => {
        expect(validateDsos([])).toEqual([]);
    });

    it('treats a null store as having no known tracks, clips, or devices', () => {
        mocks.trackStoreValue.value = null;
        const dso: Dso = { op: 'mute_track', track_id: 'track-1', muted: true };
        expect(validateDsos([dso])).toEqual([{ dso, reason: 'Track "track-1" does not exist' }]);
    });

    const trackExistenceOps: Array<{ label: string; valid: Dso; invalid: Dso }> = [
        {
            label: 'remove_track',
            valid: { op: 'remove_track', track_id: 'track-1' },
            invalid: { op: 'remove_track', track_id: 'missing' },
        },
        {
            label: 'rename_track',
            valid: { op: 'rename_track', track_id: 'track-1', name: 'Kit' },
            invalid: { op: 'rename_track', track_id: 'missing', name: 'Kit' },
        },
        {
            label: 'mute_track',
            valid: { op: 'mute_track', track_id: 'track-1', muted: true },
            invalid: { op: 'mute_track', track_id: 'missing', muted: true },
        },
        {
            label: 'solo_track',
            valid: { op: 'solo_track', track_id: 'track-1', soloed: true },
            invalid: { op: 'solo_track', track_id: 'missing', soloed: true },
        },
        {
            label: 'arm_track',
            valid: { op: 'arm_track', track_id: 'track-1', armed: true },
            invalid: { op: 'arm_track', track_id: 'missing', armed: true },
        },
        {
            label: 'color_track',
            valid: { op: 'color_track', track_id: 'track-1', color: '#fff' },
            invalid: { op: 'color_track', track_id: 'missing', color: '#fff' },
        },
        {
            label: 'reorder_track',
            valid: { op: 'reorder_track', track_id: 'track-1', new_index: 0 },
            invalid: { op: 'reorder_track', track_id: 'missing', new_index: 0 },
        },
        {
            label: 'insert_device',
            valid: { op: 'insert_device', track_id: 'track-1', device_type: 'reverb' },
            invalid: { op: 'insert_device', track_id: 'missing', device_type: 'reverb' },
        },
    ];

    it.each(trackExistenceOps)('validates track existence for $label', ({ valid, invalid }) => {
        expect(validateDsos([valid])).toEqual([]);
        expect(validateDsos([invalid])).toEqual([{ dso: invalid, reason: 'Track "missing" does not exist' }]);
    });

    const clipExistenceOps: Array<{ label: string; valid: Dso; invalid: Dso }> = [
        {
            label: 'remove_clip',
            valid: { op: 'remove_clip', clip_id: 'clip-1' },
            invalid: { op: 'remove_clip', clip_id: 'missing' },
        },
        {
            label: 'rename_clip',
            valid: { op: 'rename_clip', clip_id: 'clip-1', name: 'Loop' },
            invalid: { op: 'rename_clip', clip_id: 'missing', name: 'Loop' },
        },
        {
            label: 'split_clip',
            valid: { op: 'split_clip', clip_id: 'clip-1', split_at_beats: 4 },
            invalid: { op: 'split_clip', clip_id: 'missing', split_at_beats: 4 },
        },
        {
            label: 'transpose_notes',
            valid: { op: 'transpose_notes', clip_id: 'clip-1', semitones: 2 },
            invalid: { op: 'transpose_notes', clip_id: 'missing', semitones: 2 },
        },
        {
            label: 'humanize_midi',
            valid: { op: 'humanize_midi', clip_id: 'clip-1', timing_amount: 0.1, velocity_amount: 0.1 },
            invalid: { op: 'humanize_midi', clip_id: 'missing', timing_amount: 0.1, velocity_amount: 0.1 },
        },
    ];

    it.each(clipExistenceOps)('validates clip existence for $label', ({ valid, invalid }) => {
        expect(validateDsos([valid])).toEqual([]);
        expect(validateDsos([invalid])).toEqual([{ dso: invalid, reason: 'Clip "missing" does not exist' }]);
    });

    const generationOps: Array<{ label: string; valid: Dso; invalid: Dso }> = [
        {
            label: 'generate_melody',
            valid: {
                op: 'generate_melody',
                track_id: 'track-1',
                style: 'pop',
                key: 'C',
                scale: 'major',
                octave: 4,
                bars: 4,
                density: 0.5,
            },
            invalid: {
                op: 'generate_melody',
                track_id: 'missing',
                style: 'pop',
                key: 'C',
                scale: 'major',
                octave: 4,
                bars: 4,
                density: 0.5,
            },
        },
        {
            label: 'generate_chords',
            valid: {
                op: 'generate_chords',
                track_id: 'track-1',
                key: 'C',
                progression: 'I-IV-V',
                bars: 4,
                voicing: 'close',
            },
            invalid: {
                op: 'generate_chords',
                track_id: 'missing',
                key: 'C',
                progression: 'I-IV-V',
                bars: 4,
                voicing: 'close',
            },
        },
        {
            label: 'generate_drums',
            valid: { op: 'generate_drums', track_id: 'track-1', style: 'rock', bars: 4, density: 0.5 },
            invalid: { op: 'generate_drums', track_id: 'missing', style: 'rock', bars: 4, density: 0.5 },
        },
    ];

    it.each(generationOps)('validates track existence for $label', ({ valid, invalid }) => {
        expect(validateDsos([valid])).toEqual([]);
        expect(validateDsos([invalid])).toEqual([{ dso: invalid, reason: 'Track "missing" does not exist' }]);
    });

    it('flags a missing track and an inverted beat range for add_clip', () => {
        const dso: Dso = {
            op: 'add_clip',
            track_id: 'missing',
            name: 'New',
            type: 'audio',
            start_beats: 8,
            end_beats: 4,
        };
        expect(validateDsos([dso])).toEqual([
            { dso, reason: 'Track "missing" does not exist' },
            { dso, reason: 'Clip end must be after start' },
        ]);
        const ok: Dso = {
            op: 'add_clip',
            track_id: 'track-1',
            name: 'New',
            type: 'audio',
            start_beats: 0,
            end_beats: 4,
        };
        expect(validateDsos([ok])).toEqual([]);
    });

    const relocateOps: Array<{ label: string; valid: Dso; invalid: Dso }> = [
        {
            label: 'move_clip',
            valid: { op: 'move_clip', clip_id: 'clip-1', destination_track_id: 'track-1', destination_start_beats: 0 },
            invalid: {
                op: 'move_clip',
                clip_id: 'missing-clip',
                destination_track_id: 'missing-track',
                destination_start_beats: 0,
            },
        },
        {
            label: 'duplicate_clip',
            valid: {
                op: 'duplicate_clip',
                clip_id: 'clip-1',
                destination_track_id: 'track-1',
                destination_start_beats: 0,
            },
            invalid: {
                op: 'duplicate_clip',
                clip_id: 'missing-clip',
                destination_track_id: 'missing-track',
                destination_start_beats: 0,
            },
        },
    ];

    it.each(relocateOps)('flags a missing clip and destination track for $label', ({ valid, invalid }) => {
        expect(validateDsos([valid])).toEqual([]);
        expect(validateDsos([invalid])).toEqual([
            { dso: invalid, reason: 'Clip "missing-clip" does not exist' },
            { dso: invalid, reason: 'Destination track "missing-track" does not exist' },
        ]);
    });

    const deviceOps: Array<{ label: string; valid: Dso; invalid: Dso }> = [
        {
            label: 'remove_device',
            valid: { op: 'remove_device', device_id: 'device-1', track_id: 'track-1' },
            invalid: { op: 'remove_device', device_id: 'missing', track_id: 'track-1' },
        },
        {
            label: 'bypass_device',
            valid: { op: 'bypass_device', device_id: 'device-1', bypassed: true },
            invalid: { op: 'bypass_device', device_id: 'missing', bypassed: true },
        },
    ];

    it.each(deviceOps)('validates device existence for $label', ({ valid, invalid }) => {
        expect(validateDsos([valid])).toEqual([]);
        expect(validateDsos([invalid])).toEqual([{ dso: invalid, reason: 'Device "missing" does not exist' }]);
    });

    it('rejects set_tempo bpm outside 20-999 and accepts values inside the range', () => {
        expect(validateDsos([{ op: 'set_tempo', bpm: 10 }])).toEqual([
            { dso: { op: 'set_tempo', bpm: 10 }, reason: 'Tempo 10 out of range (20-999)' },
        ]);
        expect(validateDsos([{ op: 'set_tempo', bpm: 1000 }])).toEqual([
            { dso: { op: 'set_tempo', bpm: 1000 }, reason: 'Tempo 1000 out of range (20-999)' },
        ]);
        expect(validateDsos([{ op: 'set_tempo', bpm: 120 }])).toEqual([]);
    });

    it('flags a missing track and out-of-range gain for set_track_volume', () => {
        const dso: Dso = { op: 'set_track_volume', track_id: 'missing', gain: 2 };
        expect(validateDsos([dso])).toEqual([
            { dso, reason: 'Track "missing" does not exist' },
            { dso, reason: 'Gain 2 out of range (0-1.5)' },
        ]);
        expect(validateDsos([{ op: 'set_track_volume', track_id: 'track-1', gain: 0.8 }])).toEqual([]);
    });

    it('flags a missing track and out-of-range pan for set_track_pan', () => {
        const dso: Dso = { op: 'set_track_pan', track_id: 'missing', pan: 75 };
        expect(validateDsos([dso])).toEqual([
            { dso, reason: 'Track "missing" does not exist' },
            { dso, reason: 'Pan 75 out of range (-50 to 50)' },
        ]);
        expect(validateDsos([{ op: 'set_track_pan', track_id: 'track-1', pan: -10 }])).toEqual([]);
    });

    it('flags missing source and destination tracks independently for create_send', () => {
        const dso: Dso = { op: 'create_send', from_track_id: 'missing-a', to_track_id: 'missing-b', gain: 0.5 };
        expect(validateDsos([dso])).toEqual([
            { dso, reason: 'Source track "missing-a" does not exist' },
            { dso, reason: 'Destination track "missing-b" does not exist' },
        ]);
        expect(
            validateDsos([{ op: 'create_send', from_track_id: 'track-1', to_track_id: 'track-1', gain: 0.5 }])
        ).toEqual([]);
    });

    it('treats "latest" as always valid for set_device_param but flags an unknown device id', () => {
        expect(validateDsos([{ op: 'set_device_param', device_id: 'latest', param_name: 'mix', value: 0.5 }])).toEqual(
            []
        );
        const dso: Dso = { op: 'set_device_param', device_id: 'missing', param_name: 'mix', value: 0.5 };
        expect(validateDsos([dso])).toEqual([{ dso, reason: 'Device "missing" does not exist' }]);
    });

    it('flags a missing clip and out-of-range note pitch/velocity by index for add_midi_notes', () => {
        const dso: Dso = {
            op: 'add_midi_notes',
            clip_id: 'missing',
            notes: [
                { pitch: 60, start_beat: 0, duration: 1, velocity: 100 },
                { pitch: 200, start_beat: 1, duration: 1, velocity: -5 },
            ],
        };
        expect(validateDsos([dso])).toEqual([
            { dso, reason: 'Clip "missing" does not exist' },
            { dso, reason: 'Note 1 pitch 200 out of range (0-127)' },
            { dso, reason: 'Note 1 velocity -5 out of range (0-127)' },
        ]);
    });

    it('flags a missing clip and out-of-range gain for set_clip_gain', () => {
        const dso: Dso = { op: 'set_clip_gain', clip_id: 'missing', gain: 3 };
        expect(validateDsos([dso])).toEqual([
            { dso, reason: 'Clip "missing" does not exist' },
            { dso, reason: 'Clip gain 3 out of range (0-2)' },
        ]);
        expect(validateDsos([{ op: 'set_clip_gain', clip_id: 'clip-1', gain: 1 }])).toEqual([]);
    });

    it('delegates set_time_signature validation and surfaces the returned reason', () => {
        const dso: Dso = { op: 'set_time_signature', numerator: 7, denominator: 3 };
        expect(validateDsos([dso])).toEqual([
            { dso, reason: 'Time signature denominator 3 must be one of 2, 4, 8, or 16' },
        ]);
        expect(validateDsos([{ op: 'set_time_signature', numerator: 4, denominator: 4 }])).toEqual([]);
    });

    it('never validates add_track or set_loop payloads', () => {
        expect(validateDsos([{ op: 'add_track', name: 'New', kind: 'audio' }])).toEqual([]);
        expect(validateDsos([{ op: 'set_loop', start_beats: 0, end_beats: 4, enabled: true }])).toEqual([]);
    });

    it('pre-registers an add_track injected track_id so later DSOs in the same batch can target it', () => {
        mocks.trackStoreValue.value = trackState([]);
        const dsos: Dso[] = [
            { op: 'add_track', name: 'Synth', kind: 'midi', track_id: 'new-track' },
            { op: 'mute_track', track_id: 'new-track', muted: true },
        ];
        expect(validateDsos(dsos)).toEqual([]);
    });
});
