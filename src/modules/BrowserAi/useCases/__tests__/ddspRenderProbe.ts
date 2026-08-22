import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { resolveDdspInstrument } from '../../models/DdspInstrumentCatalog';
import { checkDdspInstrumentReady } from '../../repositories/checkDdspInstrumentReady';
import { cleanupUnpublishedDdspGeneration } from '../../repositories/cleanupUnpublishedDdspGeneration';
import { inferenceWorkerBridge } from '../../repositories/inferenceWorkerBridge';
import { downloadModel } from '../../repositories/modelDownloadManager';
import { publishDdspInstrumentGeneration } from '../../repositories/publishDdspInstrumentGeneration';
import { removeDdspInstrumentGenerations } from '../../repositories/removeDdspInstrumentGenerations';
import { stageDdspInstrumentGeneration } from '../../repositories/stageDdspInstrumentGeneration';
import { withDdspInstrumentLock } from '../../repositories/withDdspInstrumentLock';
import { renderDdspInstrument } from '../renderDdspInstrument';

const instrument = resolveDdspInstrument('ddsp-violin');
const generation = {
    id: instrument.id,
    version: instrument.artifactVersion,
    artifacts: instrument.artifacts,
};
const DURATION_SECONDS = 0.503;

type DdspRenderProof = {
    admissionWithheld: boolean;
    backend: string;
    finite: boolean;
    peak: number;
    pcmLength: number;
};

type DdspRenderProbe = {
    prepare: () => Promise<{ artifactCount: number; ready: boolean }>;
    renderOffline: () => Promise<DdspRenderProof>;
};

async function prepare(): Promise<{ artifactCount: number; ready: boolean }> {
    await withDdspInstrumentLock(instrument.id, 'exclusive', async () => {
        await removeDdspInstrumentGenerations({ id: instrument.id });
        await stageDdspInstrumentGeneration(generation);
        let published = false;
        try {
            for (const artifact of instrument.artifacts) {
                await downloadModel({
                    spec: {
                        family: 'ddsp',
                        modelId: `${instrument.id}/${instrument.artifactVersion}/${artifact.path}`,
                        url: artifact.url,
                        sizeBytes: artifact.sizeBytes,
                        sha256: artifact.sha256,
                        redirectPolicy: 'reject',
                    },
                });
            }
            await publishDdspInstrumentGeneration(generation);
            published = true;
        } finally {
            if (!published) {
                await cleanupUnpublishedDdspGeneration(generation);
            }
        }
    });
    return {
        ready: await checkDdspInstrumentReady(generation),
        artifactCount: instrument.artifacts.length,
    };
}

async function renderOffline(): Promise<DdspRenderProof> {
    inferenceWorkerBridge.terminateAll();
    const result = await renderDdspInstrument({
        phraseId: 'ddsp-hardware-proof',
        instrumentId: instrument.id,
        notes: [{ pitch: 50, velocity: 100, startSec: 0, durationSec: 0.45 }],
        durationSec: DURATION_SECONDS,
    });
    let peak = 0;
    for (const sample of result.audio) {
        peak = Math.max(peak, Math.abs(sample));
    }
    return {
        admissionWithheld: !MODEL_RELEASE_ADMISSION.ddsp,
        backend: result.backend,
        finite: result.audio.length > 0 && result.audio.every(Number.isFinite),
        peak,
        pcmLength: result.audio.length,
    };
}

Reflect.set(window, '__SOURDAW_DDSP_RENDER_PROBE__', { prepare, renderOffline } satisfies DdspRenderProbe);
