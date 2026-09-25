import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { WHISPER_MODEL_ARTIFACT } from '../../repositories/voiceInput/whisperModelArtifact';
import { storeVerifiedWhisperModel } from '../../repositories/voiceNativeAdapter/storeVerifiedWhisperModel';
import { voiceInputAvailabilityStore } from '../../stores/voiceInputAvailabilityStore';
import { voiceModelSetupStore } from '../../stores/voiceModelSetupStore';
import { loadCachedWhisperModel } from '../voiceDictation/loadCachedWhisperModel';

export type DownloadWhisperModelOptions = {
    downloadConsent?: boolean;
    onProgress?: (progress: number) => void;
    signal?: AbortSignal;
};

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
    if (!globalThis.crypto?.subtle) {
        throw new TypeError('Web Crypto is required to verify the Whisper model download');
    }
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

async function fetchWhisperModelBytes(
    signal: AbortSignal | undefined,
    reportProgress: (progress: number) => void
): Promise<Uint8Array<ArrayBuffer>> {
    const response = await fetch(WHISPER_MODEL_ARTIFACT.url, {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: signal ?? null,
    });
    if (!response.ok) {
        throw new Error(`Whisper model download failed: HTTP ${String(response.status)}`);
    }
    if (response.body === null) {
        return new Uint8Array(await response.arrayBuffer());
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
        received += value.byteLength;
        reportProgress(received / WHISPER_MODEL_ARTIFACT.sizeBytes);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

async function verifyDownloadedModelBytes(bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (bytes.byteLength !== WHISPER_MODEL_ARTIFACT.sizeBytes) {
        throw new Error(
            `Whisper model size mismatch: expected ${String(WHISPER_MODEL_ARTIFACT.sizeBytes)} bytes, received ${String(bytes.byteLength)}`
        );
    }
    if ((await sha256Hex(bytes)) !== WHISPER_MODEL_ARTIFACT.sha256) {
        throw new Error('Whisper model digest mismatch — the download was not stored.');
    }
}

function retryableMessage(error: unknown, signal: AbortSignal | undefined): string {
    if (signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')) {
        return 'The model download was interrupted before completion. Nothing was stored; retry whenever you are ready.';
    }
    return error instanceof Error ? error.message : String(error);
}

/**
 * Download, verify and install the pinned Whisper speech model behind an
 * explicit user gesture.
 *
 * The consent gate is first and unconditional: without `downloadConsent:
 * true` this throws before any fetch, which is what keeps the
 * no-implicit-download guarantee. Every later failure — network, interruption,
 * digest mismatch, native refusal — is reported through
 * `voiceModelSetupStore` as a retryable `error` and leaves the native cache
 * untouched, so the outcome lives in the store and the promise resolves
 * rather than rejecting a second report at the caller.
 */
export async function downloadWhisperModel(options: DownloadWhisperModelOptions = {}): Promise<void> {
    if (options.downloadConsent !== true) {
        throw new Error('Explicit model-download consent is required before the Whisper speech model can be fetched.');
    }
    if (!MODEL_RELEASE_ADMISSION.whisper) {
        throw new Error('Local Whisper is withheld by this release.');
    }

    const reportProgress = (progress: number): void => {
        const clamped = Math.min(1, Math.max(0, progress));
        voiceModelSetupStore.set({ state: 'downloading', progress: clamped });
        options.onProgress?.(clamped);
    };
    reportProgress(0);

    try {
        options.signal?.throwIfAborted();
        const bytes = await fetchWhisperModelBytes(options.signal, reportProgress);
        options.signal?.throwIfAborted();
        await verifyDownloadedModelBytes(bytes);
        options.signal?.throwIfAborted();
        await storeVerifiedWhisperModel(bytes);
        // The verified store is on disk; loading it back through the existing
        // cache-only boundary both arms dictation and proves the install.
        await loadCachedWhisperModel();
    } catch (error) {
        voiceModelSetupStore.set({ state: 'error', message: retryableMessage(error, options.signal) });
        return;
    }

    voiceModelSetupStore.set({ state: 'ready' });
    voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });
}
