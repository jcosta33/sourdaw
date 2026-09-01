import { describe, expect, it, vi } from 'vitest';

/**
 * readDawProjectZip must never run ZIP inflate/CRC work on the caller's
 * thread (issue #3317): it hands the archive to the guarded-zip worker via
 * `extractDawProjectZipEntries` instead of calling `extractGuardedZip`
 * directly. Mocking `extractGuardedZip` here proves the point at the module
 * boundary — if a regression re-added a direct call, this mock would
 * intercept it and the "never calls" assertions below would fail.
 */
const mocks = vi.hoisted(() => ({
    extractGuardedZip: vi.fn(),
    extractDawProjectZipEntries: vi.fn(),
}));

vi.mock('#/infra/archive/extractGuardedZip', () => ({
    extractGuardedZip: mocks.extractGuardedZip,
    ZipArchiveError: class ZipArchiveError extends Error {
        override readonly name = 'ZipArchiveError';
    },
}));

vi.mock('../extractDawProjectZipEntries', () => ({
    extractDawProjectZipEntries: mocks.extractDawProjectZipEntries,
}));

import { DAW_PROJECT_ZIP_LIMITS } from '../dawProjectZipLimits';
import { readDawProjectZip } from '../readDawProjectZip';

function utf8(text: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(new TextEncoder().encode(text));
}

function withBom(text: string): Uint8Array<ArrayBuffer> {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const content = utf8(text);
    const out = new Uint8Array(bom.length + content.length);
    out.set(bom);
    out.set(content, bom.length);
    return out;
}

describe('readDawProjectZip — routes extraction through the guarded-zip worker', () => {
    it('never calls the main-thread extractGuardedZip', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValue({ entries: { 'project.xml': utf8('<Project/>') } });

        await readDawProjectZip(new ArrayBuffer(8));

        expect(mocks.extractGuardedZip).not.toHaveBeenCalled();
    });

    it('calls the worker request helper with the DAWproject archive limits for the header phase', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValue({ entries: { 'project.xml': utf8('<Project/>') } });

        await readDawProjectZip(new ArrayBuffer(8));

        expect(mocks.extractDawProjectZipEntries).toHaveBeenCalledWith(
            expect.objectContaining({ phase: 'header', restrictLimits: DAW_PROJECT_ZIP_LIMITS })
        );
    });

    it('calls the worker request helper with the DAWproject archive limits for the audio phase', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValueOnce({ entries: { 'project.xml': utf8('<Project/>') } });
        mocks.extractDawProjectZipEntries.mockResolvedValueOnce({ entries: { 'audio/kick.wav': utf8('RIFF....') } });

        const result = await readDawProjectZip(new ArrayBuffer(8));
        await result.readAudioAssets();

        expect(mocks.extractDawProjectZipEntries).toHaveBeenLastCalledWith(
            expect.objectContaining({ phase: 'audio', restrictLimits: DAW_PROJECT_ZIP_LIMITS })
        );
        expect(mocks.extractGuardedZip).not.toHaveBeenCalled();
    });
});

describe('readDawProjectZip — assembling extracted entries', () => {
    it('extracts project.xml content from the header phase result', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValue({ entries: { 'project.xml': utf8('<Project/>') } });

        const result = await readDawProjectZip(new ArrayBuffer(8));

        expect(result.projectXml).toBe('<Project/>');
    });

    it('matches project.xml case-insensitively (Project.xml)', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValue({ entries: { 'Project.xml': utf8('<Project/>') } });

        const result = await readDawProjectZip(new ArrayBuffer(8));

        expect(result.projectXml).toBe('<Project/>');
    });

    it('throws when the header phase did not return project.xml', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValue({ entries: {} });

        await expect(readDawProjectZip(new ArrayBuffer(8))).rejects.toThrow(/did not extract project\.xml/i);
    });

    it('propagates a worker-reported missing-project error', async () => {
        mocks.extractDawProjectZipEntries.mockRejectedValue(
            new Error('DAWproject archive is missing project.xml at its root')
        );

        await expect(readDawProjectZip(new ArrayBuffer(8))).rejects.toThrow(/missing project\.xml/i);
    });

    it('returns null metadataXml when absent', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValue({ entries: { 'project.xml': utf8('<Project/>') } });

        const result = await readDawProjectZip(new ArrayBuffer(8));

        expect(result.metadataXml).toBeNull();
    });

    it('extracts metadata.xml when present', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValue({
            entries: { 'project.xml': utf8('<Project/>'), 'metadata.xml': utf8('<Metadata/>') },
        });

        const result = await readDawProjectZip(new ArrayBuffer(8));

        expect(result.metadataXml).toBe('<Metadata/>');
    });

    it('strips a UTF-8 BOM prefix from project.xml', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValue({ entries: { 'project.xml': withBom('<Project/>') } });

        const result = await readDawProjectZip(new ArrayBuffer(8));

        expect(result.projectXml).toBe('<Project/>');
        expect(result.projectXml.charCodeAt(0)).toBe(0x3c); // '<'
    });

    it('resolves readAudioAssets from the audio-phase entries', async () => {
        mocks.extractDawProjectZipEntries.mockResolvedValueOnce({ entries: { 'project.xml': utf8('<Project/>') } });
        mocks.extractDawProjectZipEntries.mockResolvedValueOnce({
            entries: { 'audio/kick.wav': utf8('kick'), 'audio/snare.wav': utf8('snare') },
        });

        const result = await readDawProjectZip(new ArrayBuffer(8));
        const audioAssets = await result.readAudioAssets();

        expect(audioAssets.size).toBe(2);
        expect(audioAssets.has('audio/kick.wav')).toBe(true);
    });
});
