import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { KOKORO_MODEL_ARTIFACT } from '../../models/KokoroArtifactManifest';
import { inferenceWorkerBridge } from '../../repositories/inferenceWorkerBridge';
import { downloadModel } from '../../repositories/modelDownloadManager';
import { modelStorageWorkerBridge } from '../../repositories/modelStorageWorkerBridge';
import { readRenderCache } from '../../repositories/readRenderCache';
import { readVerifiedModel } from '../../repositories/readVerifiedModel';
import { textToKokoroInputIds } from '../../services/kokoroTokenizer';
import { inferenceProgressStore } from '../../stores/inferenceProgressStore';
import { renderQueueStore } from '../../stores/renderQueueStore';
import { renderKokoroTts } from '../renderKokoroTts';

const PHRASE_ID = 'kokoro-real-owner';
const artifact = KOKORO_MODEL_ARTIFACT;
type OldOutcome = { status: 'resolved' } | { status: 'rejected'; message: string };
let oldOutcome: Promise<OldOutcome> | undefined;

async function sha256(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function prepare() {
    await downloadModel({
        spec: {
            family: 'kokoro',
            modelId: artifact.id,
            url: artifact.url,
            sizeBytes: artifact.sizeBytes,
            sha256: artifact.sha256,
        },
    });
    const verified = await modelStorageWorkerBridge.verifyModel({
        family: 'kokoro',
        modelId: artifact.id,
        expectedSizeBytes: artifact.sizeBytes,
        expectedSha256: artifact.sha256,
    });
    const modelDataPort = await readVerifiedModel({ family: 'kokoro', modelId: artifact.id, ...artifact });
    if (!modelDataPort) {
        throw new Error('The real OPFS model read did not return a verified model port');
    }
    const providers = await inferenceWorkerBridge.loadOnnxSession({ modelId: artifact.id, modelDataPort });
    const tokens = textToKokoroInputIds('hello world');
    return {
        admitted: MODEL_RELEASE_ADMISSION.kokoro,
        verified,
        providers,
        inputIds: Array.from(tokens.inputIds, Number),
        tokenCount: tokens.tokenCount,
        warnings: tokens.warnings,
    };
}

function render(text: string) {
    return renderKokoroTts({
        phraseId: PHRASE_ID,
        text,
        speakerId: 'af_heart',
        speed: 1,
        targetDurationSec: 1.25,
    });
}

function startOld(): void {
    if (oldOutcome) {
        throw new Error('The old request has already started');
    }
    oldOutcome = render('sun moon').then(
        () => ({ status: 'resolved' }),
        (error: unknown) => ({ status: 'rejected', message: error instanceof Error ? error.message : String(error) })
    );
}

async function settleOld(): Promise<OldOutcome> {
    if (!oldOutcome) {
        throw new Error('The old request has not started');
    }
    return oldOutcome;
}

async function renderCurrent() {
    const result = await render('hello world');
    let peak = 0;
    let sum = 0;
    let squares = 0;
    for (const sample of result.audio) {
        peak = Math.max(peak, Math.abs(sample));
        sum += sample;
        squares += sample * sample;
    }
    const length = result.audio.length;
    return {
        sampleRate: result.sampleRate,
        provenance: result.provenance,
        length,
        finite: length > 0 && result.audio.every(Number.isFinite),
        peak,
        rms: Math.sqrt(squares / length),
        variance: squares / length - (sum / length) ** 2,
        first: result.audio[0],
        last: result.audio[length - 1],
        sha256: await sha256(new Float32Array(result.audio).buffer),
    };
}

function state() {
    return structuredClone({ queue: renderQueueStore.value, progress: inferenceProgressStore.value });
}

async function cacheWitness(text: string) {
    // Derive the expected identity independently of the queue's recorded cache key.
    const identity = `${artifact.id}:kokoro-q8:0${text}:af_heart:1:1.25`;
    const cacheKey = await sha256(new TextEncoder().encode(identity).buffer);
    const audio = await readRenderCache({ cacheKey });
    return {
        cacheKey,
        length: audio?.length ?? null,
        sha256: audio ? await sha256(new Float32Array(audio).buffer) : null,
    };
}

Reflect.set(window, '__SOURDAW_KOKORO_RENDER_PROBE__', {
    prepare,
    startOld,
    settleOld,
    renderCurrent,
    state,
    cacheWitness,
    cleanup: () => {
        inferenceWorkerBridge.terminateAll();
        modelStorageWorkerBridge.terminate();
    },
});
