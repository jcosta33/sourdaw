/**
 * A DAWproject export that could not bundle some of the project's audio must
 * say so (audit M-263).
 *
 * Clips whose buffer is not in the AudioEngine cache are skipped by
 * `exportDawProject` and serialize as a bare `<Clip/>` with no `<Audio>` child.
 * The destination DAW then shows the clip playing silence, and the export
 * reported unqualified success. The `.sourdaw` export path already warns for
 * exactly this ("N audio files could not be bundled with the export"); this is
 * the same warning on the interchange path.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    exportDawProject: vi.fn(),
    notifyUser: vi.fn(),
    logError: vi.fn(),
}));

vi.mock('../../useCases/exportDawProject', () => ({ exportDawProject: mocks.exportDawProject }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.logError, warn: vi.fn() } }));

import { handleExportDawProject } from '../handleExportDawProject';

function notificationsOfSeverity(severity: string): string[] {
    return mocks.notifyUser.mock.calls
        .filter((call) => call[1] === severity)
        .map((call) => String(call[0]));
}

describe('handleExportDawProject — unbundled audio (audit M-263)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} });
    });

    it('warns the user, naming how many audio files were left out', async () => {
        mocks.exportDawProject.mockResolvedValue({
            bytes: new Uint8Array([1, 2, 3]),
            fileName: 'Song.dawproject',
            missingAudioCount: 2,
        });

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        const warnings = notificationsOfSeverity('warning');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('2');
        // The export still happened and still says so.
        expect(notificationsOfSeverity('success')).toEqual(['Exported Song.dawproject']);
    });

    it('says nothing extra when every buffer was bundled', async () => {
        mocks.exportDawProject.mockResolvedValue({
            bytes: new Uint8Array([1, 2, 3]),
            fileName: 'Song.dawproject',
            missingAudioCount: 0,
        });

        await handleExportDawProject.execute({ type: 'exportDawProject' });

        // Pin the negative: the warning must be conditional, not unconditional.
        expect(notificationsOfSeverity('warning')).toEqual([]);
        expect(notificationsOfSeverity('success')).toEqual(['Exported Song.dawproject']);
    });
});
