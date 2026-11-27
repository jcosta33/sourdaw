import { assert, expect, it, vi } from 'vitest';

import { registerDeviceEnginePorts } from '#/app/registerDeviceEnginePorts';
import { registerProjectLifecycle } from '#/app/registerProjectLifecycle';
import { trackStore } from '#/modules/Arrangement/stores';
import { registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';

import { handleCreateProjectFromTemplate } from '../../../../handlers/projectTemplate/handleCreateProjectFromTemplate';
import { arrangementStore } from '../../../../stores/arrangementStore';

import type { MidiNote } from '#/modules/MIDI/stores';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    projectTrackToLiveStrip: vi.fn(),
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    ensureTrackStrips: vi.fn(() => ({ status: 'ready', externalPluginActivations: [] })),
}));

const tracks = [
    {
        name: 'Ciabatta Growl',
        clipName: 'Growl',
        windows: [
            [5, 30],
            [72, 95],
            [148, 170],
            [232, 275],
            [304, 328],
        ],
        expected: [
            [
                [5.8, 57],
                [9.82, 57],
                [13.84, 57],
            ],
            [
                [72.15, 60],
                [72.96, 64],
                [74.97, 62],
            ],
            [
                [148.16, 64],
                [148.97, 62],
                [150.17, 57],
            ],
            [
                [233.83, 57],
                [237.04, 57],
                [239.86, 57],
            ],
            [
                [305.01, 64],
                [305.82, 57],
                [307.02, 60],
            ],
        ],
    },
    {
        name: 'Naan Sitar',
        clipName: 'Sitar',
        windows: [
            [44, 69],
            [72, 95],
            [148, 175],
            [288, 304],
            [304, 332],
        ],
        expected: [
            [
                [49.34, 72],
                [54.35, 74],
                [59.75, 76],
            ],
            [
                [78.87, 67],
                [82.18, 64],
                [85.88, 62],
            ],
            [
                [151.38, 81],
                [153.79, 79],
                [156.59, 74],
            ],
            [
                [294.15, 64],
                [297.46, 62],
                [301.16, 69],
            ],
            [
                [304.47, 76],
                [308.17, 78],
                [311.48, 76],
            ],
        ],
    },
] as const;

function phraseStarts(notes: MidiNote[], windows: readonly (readonly [number, number])[]) {
    return windows.map(([start, end]) =>
        notes
            .filter((note) => note.startBeat >= start && note.startBeat < end)
            .slice(0, 3)
            .map((note) => [Number(note.startBeat.toFixed(2)), note.pitch])
    );
}

it('publishes the sequencer and sitar phrases across Nebula Drift’s arrangement', async () => {
    registerDeviceEnginePorts();
    registerProjectLifecycle();
    registerHandlerMap({ createProjectFromTemplate: handleCreateProjectFromTemplate });
    await executeAppAction({ type: 'createProjectFromTemplate', payload: { templateId: 'demo-nebula-drift' } });

    const arrangementState = arrangementStore.value;
    const arrangement = arrangementState?.arrangements.find(({ id }) => id === arrangementState.activeArrangementId);
    assert.isDefined(arrangement);

    for (const { name, clipName, windows, expected } of tracks) {
        const track = trackStore.value?.tracks.find((candidate) => candidate.name === name);
        assert.isDefined(track, name);
        expect(track).toMatchObject({ kind: 'midi' });
        const clip = track.clips.find((candidate) => candidate.name === clipName);
        assert.isDefined(clip, clipName);
        expect(clip).toMatchObject({ trackId: track.id, type: 'midi', startBeat: 0 });
        const arrangementTrack = arrangement.tracks.tracks.find((candidate) => candidate.id === track.id);
        expect(arrangementTrack?.clips).toContainEqual(clip);
        const notes = midiStore.value?.notesByClipId[clip.id];
        assert.isDefined(notes, clipName);
        expect(arrangement.midi.notesByClipId[clip.id]).toEqual(notes);
        expect(phraseStarts(notes, windows), name).toEqual(expected);
    }
});
