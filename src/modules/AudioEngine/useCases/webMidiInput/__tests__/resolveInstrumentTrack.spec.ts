import { describe, expect, it } from 'vitest';

import { resolveInstrumentTrack } from '../resolveInstrumentTrack';

import type { Device, Track, TrackStoreState } from '#/modules/Arrangement/stores';

type CreateTrackInput = {
    id: string;
    devices?: Device[];
    parent_id?: string | null;
};

function create_device(input: { id: string; type: string }): Device {
    return {
        id: input.id,
        name: input.type,
        type: input.type,
        bypassed: false,
        parameterValues: {},
    };
}

function create_track(input: CreateTrackInput): Track {
    return {
        id: input.id,
        name: input.id,
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: input.devices ?? [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: input.parent_id ?? null,
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
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function create_track_state(tracks: Track[]): TrackStoreState {
    return { tracks, selectedTrackId: null, ghostClips: [] };
}

describe('resolveInstrumentTrack', () => {
    it('resolves a child target to its toaster parent instrument track', () => {
        const parent_track = create_track({
            id: 'parent-track',
            devices: [create_device({ id: 'toaster-1', type: 'toaster' })],
        });
        const child_track = create_track({ id: 'child-track', parent_id: 'parent-track' });

        const result = resolveInstrumentTrack(create_track_state([parent_track, child_track]), 'child-track');

        expect(result).toEqual({
            instrumentTrack: parent_track,
            toasterChildPad: 0,
        });
    });

    it('returns the child pad index from the same toaster-parent resolution', () => {
        const parent_track = create_track({
            id: 'parent-track',
            devices: [create_device({ id: 'toaster-1', type: 'toaster' })],
        });
        const first_child = create_track({ id: 'first-child', parent_id: 'parent-track' });
        const target_child = create_track({ id: 'target-child', parent_id: 'parent-track' });

        const result = resolveInstrumentTrack(
            create_track_state([parent_track, first_child, target_child]),
            'target-child'
        );

        expect(result).toEqual({
            instrumentTrack: parent_track,
            toasterChildPad: 1,
        });
    });

    it('keeps the target track when the parent is not a toaster host', () => {
        const parent_track = create_track({ id: 'parent-track' });
        const child_track = create_track({ id: 'child-track', parent_id: 'parent-track' });

        const result = resolveInstrumentTrack(create_track_state([parent_track, child_track]), 'child-track');

        expect(result).toEqual({
            instrumentTrack: child_track,
            toasterChildPad: null,
        });
    });
});
