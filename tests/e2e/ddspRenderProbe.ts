import { DDSP_INSTRUMENT_CATALOG } from '../../src/modules/BrowserAi/models/DdspInstrumentCatalog';
import { inferenceWorkerBridge } from '../../src/modules/BrowserAi/repositories/inferenceWorkerBridge';
import { ddspModelStorage } from '../../src/modules/BrowserAi/repositories/ddspModelStorage';
import { midiToDdspInput } from '../../src/modules/BrowserAi/services/midiToDdspInput';
import { downloadDdspInstrument, removeDdspInstrument } from '../../src/modules/BrowserAi/useCases';

const instrument = DDSP_INSTRUMENT_CATALOG[0];
if (!instrument || !instrument.artifacts || !instrument.artifactVersion) {
    throw new Error('DDSP render probe requires an admitted instrument manifest');
}
const admittedInstrument = instrument as typeof instrument & {
    artifactVersion: string;
    artifacts: NonNullable<typeof instrument.artifacts>;
};

const downloadInstrument = downloadDdspInstrument as (input: typeof admittedInstrument) => Promise<void>;
const removeInstrument = removeDdspInstrument as (input: typeof admittedInstrument) => Promise<void>;
const storage = ddspModelStorage as {
    checkDdspInstrumentReady: (input: {
        id: string;
        version: string;
        artifacts: typeof admittedInstrument.artifacts;
    }) => Promise<boolean>;
};
const workerBridge = inferenceWorkerBridge as {
    terminateAll: () => void;
    loadDdspSession: (input: {
        modelId: string;
        artifacts: Array<{ modelId: string; path: string; sizeBytes: number; sha256: string }>;
    }) => Promise<string>;
    runDdspInference: (input: {
        type: 'run-ddsp-inference';
        requestId: string;
        modelId: string;
        pitchHz: Float32Array;
        loudnessDb: Float32Array;
        frameRate: number;
    }) => Promise<{ audio: Float32Array; backend: string }>;
};

type DdspProbe = {
    prepare: () => Promise<{ ready: boolean; artifactCount: number }>;
    renderOffline: () => Promise<{ backend: string; pcmLength: number; finite: boolean }>;
};

async function prepare(): Promise<{ ready: boolean; artifactCount: number }> {
    await removeInstrument(admittedInstrument);
    await downloadInstrument(admittedInstrument);
    const ready = await storage.checkDdspInstrumentReady({
        id: admittedInstrument.id,
        version: admittedInstrument.artifactVersion,
        artifacts: admittedInstrument.artifacts,
    });
    if (!ready) {
        throw new Error('DDSP checkpoint did not become ready after verified download');
    }
    return { ready, artifactCount: admittedInstrument.artifacts.length };
}

async function renderOffline(): Promise<{ backend: string; pcmLength: number; finite: boolean }> {
    workerBridge.terminateAll();
    const { pitchHz, loudnessDb } = midiToDdspInput({
        notes: [{ pitch: 69, velocity: 100, startSec: 0, durationSec: 0.4 }],
        durationSec: 0.5,
    });
    const backend = await workerBridge.loadDdspSession({
        modelId: admittedInstrument.id,
        artifacts: admittedInstrument.artifacts.map((artifact) => ({
            modelId: `${admittedInstrument.id}/${artifact.path}`,
            path: artifact.path,
            sizeBytes: artifact.sizeBytes,
            sha256: artifact.sha256,
        })),
    });
    const result = await workerBridge.runDdspInference({
        type: 'run-ddsp-inference',
        requestId: crypto.randomUUID(),
        modelId: admittedInstrument.id,
        pitchHz,
        loudnessDb,
        frameRate: admittedInstrument.frameRate,
    });
    const finite = result.audio.length > 0 && result.audio.every(Number.isFinite);
    if (!finite || result.backend !== 'webgpu' || backend !== 'webgpu') {
        throw new Error(`Invalid DDSP render: backend=${result.backend}, samples=${String(result.audio.length)}`);
    }
    return { backend: result.backend, pcmLength: result.audio.length, finite };
}

Reflect.set(window, '__SOURDAW_DDSP_PROBE__', { prepare, renderOffline } satisfies DdspProbe);
