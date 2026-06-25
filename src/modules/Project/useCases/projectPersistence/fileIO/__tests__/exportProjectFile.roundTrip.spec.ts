import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { normalizeTrack } from '#/modules/Arrangement/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { type ProjectData } from '../../../../models/ProjectData';
import { downloadProjectFile } from '../../../../repositories/project/downloadProjectFile';
import { exportProjectFile } from '../exportProjectFile';

// Heavy / side-effecting boundaries — stubbed so the export runs deterministically
// against the real stores we seed below. vi.mock is hoisted above these imports.
vi.mock('../../../../repositories/project/downloadProjectFile', () => ({
    downloadProjectFile: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../../arrangement/helpers', () => ({ syncCurrentArrangementToStore: vi.fn() }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/Routing/useCases', () => ({ getAllSidechainRoutes: () => [] }));
vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { exportBuffers: vi.fn().mockResolvedValue({}) },
}));

function written(): ProjectData {
    return vi.mocked(downloadProjectFile).mock.calls[0]?.[0] as ProjectData;
}

describe('exportProjectFile round-trip shape', () => {
    beforeEach(() => {
        vi.mocked(downloadProjectFile).mockClear();
        trackStore.set({
            tracks: [
                normalizeTrack({
                    id: 'track-audio',
                    name: 'Audio',
                    kind: 'audio',
                    clips: [
                        {
                            id: 'clip-a',
                            trackId: 'track-audio',
                            name: 'take',
                            startBeat: 0,
                            endBeat: 4,
                            type: 'audio',
                            audioBufferId: 'buf-1',
                            audioOffsetBeats: 2,
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#fff',
                            locked: false,
                            muted: false,
                        },
                    ],
                }),
            ],
            selectedTrackId: null,
        });
        midiStore.set({
            notesByClipId: {
                'clip-midi': [{ id: 'note-1', pitch: 64, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: { 'clip-midi': [{ id: 'cc-1', controller: 1, value: 50, beat: 0, channel: 0 }] },
            pitchBendByClipId: {},
        });
        transportStore.set({ ...transportStore.value!, tempo: 99 });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        transportStore.set({ ...defaultTransportState });
    });

    it('writes the serialized bufferId/sampleStartBeat — not the runtime audioBufferId', async () => {
        await exportProjectFile();

        const clip = written().arrangement.tracks[0]?.clips[0];
        expect(clip?.bufferId).toBe('buf-1');
        expect(clip?.sampleStartBeat).toBe(2);
        expect((clip as Record<string, unknown>).audioBufferId).toBeUndefined();
    });

    it('populates the exported MIDI maps from the MIDI store (no longer hard-coded empty)', async () => {
        await exportProjectFile();

        const midi = written().midi;
        expect(midi.notesByClipId['clip-midi']?.[0]?.pitch).toBe(64);
        expect(midi.ccByClipId['clip-midi']?.[0]?.controller).toBe(1);
    });

    it('writes the live transport tempo into the export', async () => {
        await exportProjectFile();
        expect(written().transport.tempo).toBe(99);
    });
});
