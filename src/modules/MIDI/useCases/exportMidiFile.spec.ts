import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Track } from '#/modules/Arrangement/models/Track';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { exportMidiClip } from './exportMidiFile';

vi.mock('#/modules/Arrangement/useCases/getAllTracks', () => ({
    getAllTracks: vi.fn(),
}));

const midiCell = vi.hoisted(() => ({
    value: null as {
        notesByClipId: Record<string, { id: string; pitch: number; startBeat: number; duration: number; velocity: number }[]>;
        ccByClipId: Record<string, unknown[]>;
    } | null,
}));

vi.mock('#/modules/MIDI/stores/midiStore', () => ({
    midiStore: midiCell,
}));

describe('exportMidiClip', () => {
    beforeEach(() => {
        vi.mocked(getAllTracks).mockReset();
        midiCell.value = null;
    });

    it('should not download when there are no tracks', () => {
        const downloadBlob = vi.fn();
        vi.mocked(getAllTracks).mockReturnValue([]);
        injectDependencies(exportMidiClip, { downloadBlob });

        exportMidiClip('c1');

        expect(downloadBlob).not.toHaveBeenCalled();
    });

    it('should not download when midi store is missing', () => {
        const downloadBlob = vi.fn();
        const track = {
            id: 't1',
            name: 'Lead',
            kind: 'midi' as const,
            clips: [],
        } as unknown as Track;
        vi.mocked(getAllTracks).mockReturnValue([track]);
        midiCell.value = null;
        injectDependencies(exportMidiClip, { downloadBlob });

        exportMidiClip('c1');

        expect(downloadBlob).not.toHaveBeenCalled();
    });

    it('should call downloadBlob when clip has midi notes', () => {
        const downloadBlob = vi.fn();
        const clip = {
            id: 'c1',
            trackId: 't1',
            name: 'Hook',
            startBeat: 0,
            endBeat: 4,
            type: 'midi' as const,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        const track = {
            id: 't1',
            name: 'Lead',
            kind: 'midi' as const,
            clips: [clip],
        } as unknown as Track;

        vi.mocked(getAllTracks).mockReturnValue([track]);
        midiCell.value = {
            notesByClipId: {
                c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
        };

        injectDependencies(exportMidiClip, { downloadBlob });

        exportMidiClip('c1');

        expect(downloadBlob).toHaveBeenCalledTimes(1);
        const [bytes, name, mime] = vi.mocked(downloadBlob).mock.calls[0]!;
        expect(mime).toBe('audio/midi');
        expect(name.endsWith('.mid')).toBe(true);
        expect(bytes).toBeInstanceOf(Uint8Array);
    });
});
