import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import type { RecordingSession } from '../recordingSession';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
    },
}));

type EntryHandle = { kind: 'file' } | { kind: 'directory' };

class FakeRecordingRoot {
    files = new Map<string, EntryHandle>();
    removed: string[] = [];

    // A real FileSystemDirectoryHandle aliases Symbol.asyncIterator to entries.
    [Symbol.asyncIterator](): AsyncGenerator<[string, EntryHandle]> {
        return this.entries();
    }

    async *entries(): AsyncGenerator<[string, EntryHandle]> {
        for (const [name, handle] of this.files) {
            yield [name, handle];
        }
    }

    async removeEntry(name: string): Promise<void> {
        this.removed.push(name);
        this.files.delete(name);
    }
}

function make_live_session(trackId: string, tempFile: string): RecordingSession {
    return {
        trackId,
        mediaStream: null,
        sourceNode: null,
        recordingNode: null,
        recordingWorker: null,
        captureSampleRate: 48_000,
        status: 'recording',
        onTerminal: null,
        decodePending: false,
        stopFlushTimer: null,
        producerStopAcknowledged: false,
        tempFile,
    };
}

function install_recording_storage(root: FakeRecordingRoot | null): void {
    Object.defineProperty(globalThis.navigator, 'storage', {
        configurable: true,
        value: root === null ? undefined : { getDirectory: vi.fn().mockResolvedValue(root) },
    });
}

describe('sweepAbandonedRecordingTempFilesOnce', () => {
    // Each test loads a fresh module graph so the once-per-app-run guard and
    // the session map it reads start empty and deterministic.
    type SweepModule = typeof import('../sweepAbandonedRecordingTempFiles');
    type SessionModule = typeof import('../recordingSession');
    let sweep: SweepModule['sweepAbandonedRecordingTempFilesOnce'];
    let activeSessions: SessionModule['activeSessions'];

    beforeEach(async () => {
        vi.resetModules();
        ({ sweepAbandonedRecordingTempFilesOnce: sweep } = await import('../sweepAbandonedRecordingTempFiles'));
        ({ activeSessions } = await import('../recordingSession'));
    });

    it('removes a leftover temp file from an abandoned session', async () => {
        const root = new FakeRecordingRoot();
        root.files.set('rec-tmp-crashed-take.pcm', { kind: 'file' });
        install_recording_storage(root);

        sweep();
        await vi.waitFor(() => expect(root.removed).toEqual(['rec-tmp-crashed-take.pcm']));
        expect(root.files.size).toBe(0);
    });

    it('never touches entries that are not abandoned recording temp files', async () => {
        const root = new FakeRecordingRoot();
        root.files.set('rec-tmp-crashed-take.pcm', { kind: 'file' });
        root.files.set('rec-tmp.pcm', { kind: 'file' });
        root.files.set('rec-tmp-.pcm', { kind: 'file' });
        root.files.set('rec-tmp-take.wav', { kind: 'file' });
        root.files.set('recording-take.pcm', { kind: 'file' });
        root.files.set('renders', { kind: 'directory' });
        install_recording_storage(root);

        sweep();
        await vi.waitFor(() => expect(root.removed).toEqual(['rec-tmp-crashed-take.pcm']));
        expect([...root.files.keys()].sort()).toEqual([
            'rec-tmp-.pcm',
            'rec-tmp-take.wav',
            'rec-tmp.pcm',
            'recording-take.pcm',
            'renders',
        ]);
    });

    it('spares the temp file of a session this run is still recording', async () => {
        const root = new FakeRecordingRoot();
        root.files.set('rec-tmp-crashed-take.pcm', { kind: 'file' });
        root.files.set('rec-tmp-live-take.pcm', { kind: 'file' });
        install_recording_storage(root);
        activeSessions.set('track-live', make_live_session('track-live', 'rec-tmp-live-take.pcm'));

        sweep();
        await vi.waitFor(() => expect(root.removed).toEqual(['rec-tmp-crashed-take.pcm']));
        expect(root.files.has('rec-tmp-live-take.pcm')).toBe(true);
    });

    // The sweep awaits the directory between entries, so a session starting on
    // the same first-use tick registers while the enumeration is still
    // walking. Its file is on disk before the sweep begins but held by no
    // session yet; only a live test per entry can spare it.
    it('spares a session that registers while the enumeration is still walking', async () => {
        const root = new FakeRecordingRoot();
        root.files.set('rec-tmp-crashed-take.pcm', { kind: 'file' });
        root.files.set('rec-tmp-late-session.pcm', { kind: 'file' });
        install_recording_storage(root);

        const originalRemove = root.removeEntry.bind(root);
        root.removeEntry = (name: string) =>
            originalRemove(name).then(() => {
                activeSessions.set('track-late', make_live_session('track-late', 'rec-tmp-late-session.pcm'));
            });

        sweep();
        await vi.waitFor(() => expect(root.removed).toEqual(['rec-tmp-crashed-take.pcm']));
        expect(root.files.has('rec-tmp-late-session.pcm')).toBe(true);
    });

    it('finds nothing to do when OPFS is unavailable', async () => {
        install_recording_storage(null);

        expect(() => sweep()).not.toThrow();
        expect(logger.debug).not.toHaveBeenCalledWith('Recording temp file sweep failed', expect.anything());
    });

    it('runs at most once per app run and swallows its own failure', async () => {
        const getDirectory = vi.fn().mockRejectedValue(new Error('storage gone'));
        Object.defineProperty(globalThis.navigator, 'storage', {
            configurable: true,
            value: { getDirectory },
        });

        sweep();
        sweep();
        await vi.waitFor(() => {
            expect(getDirectory).toHaveBeenCalledTimes(1);
            expect(logger.debug).toHaveBeenCalledWith('Recording temp file sweep failed', expect.any(Error));
        });
    });
});
