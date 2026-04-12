import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadMidiFile } from '../exportMidiFile';
import { downloadBlob } from '../../repositories/downloadFile';

vi.mock('../../repositories/downloadFile', () => ({
    downloadBlob: vi.fn(),
}));

describe('downloadMidiFile', () => {
    beforeEach(() => {
        vi.mocked(downloadBlob).mockClear();
    });

    it('should not download when there is no note or CC data', () => {
        downloadMidiFile({ clipName: 'Empty', clipStartBeat: 0, notes: [], ccs: [] });

        expect(downloadBlob).not.toHaveBeenCalled();
    });

    it('should download a MIDI file for note data', () => {
        downloadMidiFile({
            clipName: 'Hook',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            ccs: [],
        });

        expect(downloadBlob).toHaveBeenCalledTimes(1);
        const [bytes, name, mime] = vi.mocked(downloadBlob).mock.calls[0]!;
        expect(mime).toBe('audio/midi');
        expect(name.endsWith('.mid')).toBe(true);
        expect(bytes).toBeInstanceOf(Uint8Array);
    });

    it('should sanitize the output filename', () => {
        downloadMidiFile({
            clipName: 'Lead/Hook:*?',
            clipStartBeat: 0,
            notes: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            ccs: [],
        });

        const [, name] = vi.mocked(downloadBlob).mock.calls[0]!;
        expect(name).toBe('Lead_Hook___.mid');
    });
});
