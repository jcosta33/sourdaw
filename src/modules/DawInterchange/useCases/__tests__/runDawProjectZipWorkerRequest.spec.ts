import { zipSync } from 'fflate';
import { describe, it, expect } from 'vitest';

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
        ).toThrow();
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
