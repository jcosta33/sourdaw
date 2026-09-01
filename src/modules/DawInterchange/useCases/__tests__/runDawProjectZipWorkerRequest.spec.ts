import { zipSync } from 'fflate';
import { describe, it, expect } from 'vitest';

import { DAW_PROJECT_ZIP_LIMITS } from '../dawProjectZipLimits';
import { runDawProjectZipWorkerRequest } from '../runDawProjectZipWorkerRequest';

/**
 * Specs for the pure DAWproject ZIP worker-request core. This is the logic
 * that actually runs inside `dawProjectZip.worker.ts` off the main thread;
 * it is tested directly here (no real Worker needed) the same way
 * `runGuardedZipWorkerRequest.spec.ts` tests its shared-infra counterpart.
 */

function makeZip(entries: Record<string, Uint8Array>): ArrayBuffer {
    return zipSync(entries).buffer;
}

/**
 * Patches the declared "uncompressed size" field of each central-directory
 * record (in archive order) without touching the actual entry payload,
 * mirroring the technique `extractGuardedZip.spec.ts` uses to fake a
 * declared-size mismatch: scan for the central-directory signature
 * (`PK\x01\x02`) and rewrite the uncompressed-size field at its +24 offset.
 * This lets the DAW_PROJECT_ZIP_LIMITS byte-ceiling specs assert against
 * archives that *declare* themselves above 64 MiB without allocating any
 * real 64 MiB payload.
 */
function patchCentralDirectoryUncompressedSizes(archive: ArrayBuffer, declaredSizes: readonly number[]): ArrayBuffer {
    const bytes = new Uint8Array(archive).slice();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let entryIndex = 0;
    for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) {
            continue;
        }
        const declared = declaredSizes[entryIndex];
        if (declared !== undefined) {
            view.setUint32(offset + 24, declared, true);
        }
        entryIndex += 1;
    }
    return bytes.buffer;
}

function makeCorruptStoredZip(entries: Record<string, Uint8Array>): ArrayBuffer {
    const archive = zipSync(entries, { level: 0 });
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const nameBytes = view.getUint16(26, true);
    const extraBytes = view.getUint16(28, true);
    const dataOffset = 30 + nameBytes + extraBytes;
    const firstDataByte = archive[dataOffset];
    if (firstDataByte === undefined) {
        throw new Error('Stored ZIP fixture has no entry payload');
    }
    archive[dataOffset] = firstDataByte ^ 0xff;
    return archive.buffer;
}

function utf8(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

describe('runDawProjectZipWorkerRequest — header phase', () => {
    it('extracts project.xml content', () => {
        const bytes = makeZip({ 'project.xml': utf8('<Project/>') });
        const result = runDawProjectZipWorkerRequest({ bytes, phase: 'header' });
        expect(new TextDecoder().decode(result['project.xml'])).toBe('<Project/>');
    });

    it('matches project.xml case-insensitively (Project.xml)', () => {
        const bytes = makeZip({ 'Project.xml': utf8('<Project/>') });
        const result = runDawProjectZipWorkerRequest({ bytes, phase: 'header' });
        expect(new TextDecoder().decode(result['Project.xml'])).toBe('<Project/>');
    });

    it('rejects an absolute project.xml path', () => {
        const bytes = makeZip({ '/project.xml': utf8('<Project/>') });
        expect(() => runDawProjectZipWorkerRequest({ bytes, phase: 'header' })).toThrow(/unsafe archive path/i);
    });

    it('rejects case-folded duplicate project roots', () => {
        const bytes = makeCorruptStoredZip({
            'project.xml': utf8('<Project name="first"/>'),
            'Project.xml': utf8('<Project name="second"/>'),
        });
        expect(() => runDawProjectZipWorkerRequest({ bytes, phase: 'header' })).toThrow(/duplicate project\.xml/i);
    });

    it('throws when project.xml is missing', () => {
        const bytes = makeZip({ 'readme.txt': utf8('hello') });
        expect(() => runDawProjectZipWorkerRequest({ bytes, phase: 'header' })).toThrow(/missing project\.xml/i);
    });

    it('throws when the archive has no entries', () => {
        const bytes = makeZip({});
        expect(() => runDawProjectZipWorkerRequest({ bytes, phase: 'header' })).toThrow(/missing project\.xml/i);
    });

    it('rejects a missing project before inflating unrelated audio entries', () => {
        const bytes = makeCorruptStoredZip({ 'audio/broken.wav': utf8('RIFF....') });
        expect(() => runDawProjectZipWorkerRequest({ bytes, phase: 'header' })).toThrow(/missing project\.xml/i);
    });

    it('extracts metadata.xml when present', () => {
        const bytes = makeZip({ 'project.xml': utf8('<Project/>'), 'metadata.xml': utf8('<Metadata/>') });
        const result = runDawProjectZipWorkerRequest({ bytes, phase: 'header' });
        expect(new TextDecoder().decode(result['metadata.xml'])).toBe('<Metadata/>');
    });

    it('falls back to Metadata.xml (capitalized)', () => {
        const bytes = makeZip({ 'project.xml': utf8('<Project/>'), 'Metadata.xml': utf8('<Meta/>') });
        const result = runDawProjectZipWorkerRequest({ bytes, phase: 'header' });
        expect(new TextDecoder().decode(result['Metadata.xml'])).toBe('<Meta/>');
    });

    it('omits metadata.xml from the result when absent', () => {
        const bytes = makeZip({ 'project.xml': utf8('<Project/>') });
        const result = runDawProjectZipWorkerRequest({ bytes, phase: 'header' });
        expect(Object.keys(result)).toEqual(['project.xml']);
    });

    it('rejects case-folded duplicate metadata roots', () => {
        const bytes = makeCorruptStoredZip({
            'project.xml': utf8('<Project/>'),
            'metadata.xml': utf8('<Meta name="first"/>'),
            'Metadata.xml': utf8('<Meta name="second"/>'),
        });
        expect(() => runDawProjectZipWorkerRequest({ bytes, phase: 'header' })).toThrow(/duplicate metadata\.xml/i);
    });

    it('never extracts audio/ entries during the header phase', () => {
        const bytes = makeZip({ 'project.xml': utf8('<Project/>'), 'audio/kick.wav': utf8('RIFF....') });
        const result = runDawProjectZipWorkerRequest({ bytes, phase: 'header' });
        expect(Object.keys(result)).toEqual(['project.xml']);
    });

    it('enforces a supplied restrictLimits ceiling', () => {
        const bytes = makeZip({ 'project.xml': utf8('<Project/>'.repeat(1000)) });
        expect(() =>
            runDawProjectZipWorkerRequest({ bytes, phase: 'header', restrictLimits: { maxArchiveBytes: 4 } })
        ).toThrow(/archive byte limit exceeds 4/i);
    });
});

describe('runDawProjectZipWorkerRequest — enforces DAW_PROJECT_ZIP_LIMITS', () => {
    it('rejects an archive above the 512-entry ceiling', () => {
        const entries: Record<string, Uint8Array> = {};
        for (let index = 0; index < 513; index += 1) {
            entries[`audio/track-${index}.wav`] = utf8('x');
        }
        const bytes = makeZip(entries);

        expect(() =>
            runDawProjectZipWorkerRequest({ bytes, phase: 'audio', restrictLimits: DAW_PROJECT_ZIP_LIMITS })
        ).toThrow(/ZIP entry count exceeds 512/);
    });

    it('rejects a central-directory entry declaring an uncompressed size above the 64 MiB per-entry ceiling', () => {
        const bytes = patchCentralDirectoryUncompressedSizes(makeZip({ 'audio/big.wav': utf8('x') }), [
            64 * 1024 * 1024 + 1,
        ]);

        expect(() =>
            runDawProjectZipWorkerRequest({ bytes, phase: 'audio', restrictLimits: DAW_PROJECT_ZIP_LIMITS })
        ).toThrow(/ZIP entry exceeds the uncompressed byte limit: audio\/big\.wav/);
    });

    it('rejects a declared total uncompressed size above the 64 MiB archive ceiling', () => {
        const perEntryDeclaredBytes = 40 * 1024 * 1024;
        const bytes = patchCentralDirectoryUncompressedSizes(
            makeZip({ 'audio/one.wav': utf8('x'), 'audio/two.wav': utf8('y') }),
            [perEntryDeclaredBytes, perEntryDeclaredBytes]
        );

        expect(() =>
            runDawProjectZipWorkerRequest({ bytes, phase: 'audio', restrictLimits: DAW_PROJECT_ZIP_LIMITS })
        ).toThrow(/ZIP total uncompressed bytes exceed the archive limit/);
    });
});

describe('runDawProjectZipWorkerRequest — audio phase', () => {
    it('rejects traversal-bearing audio paths before publishing entries', () => {
        const bytes = makeZip({ 'audio/../escape.wav': utf8('RIFF....') });
        expect(() => runDawProjectZipWorkerRequest({ bytes, phase: 'audio' })).toThrow(/unsafe archive path/i);
    });

    it('extracts audio/ prefixed files', () => {
        const audioData = utf8('RIFF....');
        const bytes = makeZip({ 'project.xml': utf8('<Project/>'), 'audio/kick.wav': audioData });
        const result = runDawProjectZipWorkerRequest({ bytes, phase: 'audio' });
        expect(result['audio/kick.wav']).toBeDefined();
        expect(Array.from(result['audio/kick.wav']!)).toEqual(Array.from(audioData));
    });

    it('skips non-audio/ entries', () => {
        const bytes = makeZip({
            'project.xml': utf8('<Project/>'),
            'readme.txt': utf8('hello'),
            'audio/snare.wav': utf8('RIFF....'),
        });
        const result = runDawProjectZipWorkerRequest({ bytes, phase: 'audio' });
        expect(Object.keys(result)).toEqual(['audio/snare.wav']);
    });

    it('extracts multiple audio assets', () => {
        const bytes = makeZip({
            'project.xml': utf8('<Project/>'),
            'audio/kick.wav': utf8('kick'),
            'audio/snare.wav': utf8('snare'),
            'audio/hat.wav': utf8('hat'),
        });
        const result = runDawProjectZipWorkerRequest({ bytes, phase: 'audio' });
        expect(Object.keys(result)).toHaveLength(3);
    });
});
