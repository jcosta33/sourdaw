import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Track } from '#/modules/Arrangement/models/Track';
import { exportMidiClip } from './exportMidiFile';

describe('exportMidiClip', () => {
    it('should not download when there are no tracks', () => {
        const downloadBlob = vi.fn();
        const getAllTracks = vi.fn(() => []);
        const getMidiStoreState = vi.fn(() => ({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        }));
        injectDependencies(exportMidiClip, { downloadBlob, getAllTracks, getMidiStoreState });

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
        const getAllTracks = vi.fn(() => [track]);
        const getMidiStoreState = vi.fn(() => null);
        injectDependencies(exportMidiClip, { downloadBlob, getAllTracks, getMidiStoreState });

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

        const getAllTracks = vi.fn(() => [track]);
        const getMidiStoreState = vi.fn(() => ({
            notesByClipId: {
                c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        }));

        injectDependencies(exportMidiClip, { downloadBlob, getAllTracks, getMidiStoreState });

        exportMidiClip('c1');

        expect(downloadBlob).toHaveBeenCalledTimes(1);
        const [bytes, name, mime] = vi.mocked(downloadBlob).mock.calls[0]!;
        expect(mime).toBe('audio/midi');
        expect(name.endsWith('.mid')).toBe(true);
        expect(bytes).toBeInstanceOf(Uint8Array);
    });
});
