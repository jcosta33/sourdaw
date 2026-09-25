import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readWhisperModelArtifact, WHISPER_MODEL_ARTIFACT } from '../whisperModelArtifact';

const VALID = {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin',
    sizeBytes: 147_964_211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
};

describe('whisperModelArtifact', () => {
    it('pins the admitted whisper.cpp artifact the ADR and the native loader carry', () => {
        expect(WHISPER_MODEL_ARTIFACT).toEqual(VALID);

        // The renderer descriptor and the native cache boundary must never
        // drift apart: the writer re-verifies against these same constants.
        const speech = readFileSync(resolve(process.cwd(), 'crates/sourdaw-native/src/commands/speech.rs'), 'utf8');
        expect(speech).toContain('a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002');
        expect(speech).toContain('147_964_211');
        expect(speech).toContain('ggml-base.en.bin');
    });

    it.each([
        { name: 'a non-https URL', value: { ...VALID, url: VALID.url.replace('https://', 'http://') } },
        {
            name: 'a non-Hugging-Face origin',
            value: { ...VALID, url: VALID.url.replace('huggingface.co', 'evil.example') },
        },
        {
            name: 'an unpinned revision path',
            value: {
                ...VALID,
                url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
            },
        },
        { name: 'a non-integer size', value: { ...VALID, sizeBytes: 1.5 } },
        { name: 'a zero size', value: { ...VALID, sizeBytes: 0 } },
        { name: 'a malformed digest', value: { ...VALID, sha256: 'not-a-digest' } },
        { name: 'a non-record', value: 'ggml-base.en.bin' },
    ])('refuses $name', ({ value }) => {
        expect(() => readWhisperModelArtifact(value)).toThrow();
    });

    it('accepts the pinned descriptor', () => {
        expect(readWhisperModelArtifact(VALID)).toEqual(VALID);
    });
});
