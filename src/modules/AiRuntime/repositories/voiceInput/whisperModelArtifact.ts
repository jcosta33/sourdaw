/**
 * The pinned Whisper release artifact the consented setup flow downloads.
 *
 * This descriptor mirrors the admission recorded in ADR 0030: whisper.cpp
 * revision `5359861c739e955e79d9a303bcbc70fb988958b1` and the exact
 * `ggml-base.en.bin` byte count and SHA-256, the same constants
 * `crates/sourdaw-native/src/commands/speech.rs` carries for the cache read
 * boundary. The native writer re-verifies every byte it is handed against
 * that spec, so a drifted or tampered descriptor here fails closed at the
 * native boundary rather than poisoning the cache.
 */

export type WhisperModelArtifact = {
    url: string;
    sizeBytes: number;
    sha256: string;
};

const WHISPER_ARTIFACT_ORIGIN = 'https://huggingface.co';
const WHISPER_ARTIFACT_PATH_PATTERN = /^\/ggerganov\/whisper\.cpp\/resolve\/[a-f0-9]{40}\/ggml-base\.en\.bin$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate a Whisper artifact descriptor, refusing anything off the pinned origin, revision path, size, or digest. */
export function readWhisperModelArtifact(value: unknown): WhisperModelArtifact {
    if (!isRecord(value) || typeof value.url !== 'string') {
        throw new Error('Invalid Whisper model artifact descriptor');
    }
    let parsed: URL;
    try {
        parsed = new URL(value.url);
    } catch {
        throw new Error('Whisper model artifact URL is not parseable');
    }
    if (
        parsed.protocol !== 'https:' ||
        parsed.origin !== WHISPER_ARTIFACT_ORIGIN ||
        !WHISPER_ARTIFACT_PATH_PATTERN.test(parsed.pathname)
    ) {
        throw new Error('Whisper model artifact URL must be the pinned huggingface.co revision path');
    }
    if (typeof value.sizeBytes !== 'number' || !Number.isSafeInteger(value.sizeBytes) || value.sizeBytes <= 0) {
        throw new Error('Whisper model artifact size must be a positive integer');
    }
    if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
        throw new Error('Whisper model artifact SHA-256 must be a 64-character hex digest');
    }
    return {
        url: value.url,
        sizeBytes: value.sizeBytes,
        sha256: value.sha256,
    };
}

export const WHISPER_MODEL_ARTIFACT: WhisperModelArtifact = readWhisperModelArtifact({
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin',
    sizeBytes: 147_964_211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
});
