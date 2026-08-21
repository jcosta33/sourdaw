import {
    DDSP_INSTRUMENT_CATALOG,
    type DdspInstrumentId,
} from '../../src/modules/BrowserAi/models/DdspInstrumentCatalog';
import { ddspModelStorage } from '../../src/modules/BrowserAi/repositories/ddspModelStorage';
import { inferenceWorkerBridge } from '../../src/modules/BrowserAi/repositories/inferenceWorkerBridge';
import {
    downloadDdspInstrument,
    isDdspInstrumentId,
    removeDdspInstrument,
    renderDdspInstrument,
} from '../../src/modules/BrowserAi/useCases';

const instrument = DDSP_INSTRUMENT_CATALOG[0];
if (!instrument || !instrument.artifacts || !instrument.artifactVersion) {
    throw new Error('DDSP render probe requires an admitted instrument manifest');
}
const admittedInstrument = instrument as typeof instrument & {
    artifactVersion: string;
    artifacts: NonNullable<typeof instrument.artifacts>;
};

// `pnpm typecheck:e2e` resolves the application graph through tsconfig.e2e;
// type-aware lint uses the root app project, where these E2E imports sit
// outside the project. Keep the casts at the callable boundary and in sync
// with the production catalog-ID contract.
const downloadInstrument = downloadDdspInstrument as (instrumentId: DdspInstrumentId) => Promise<void>;
const removeInstrument = removeDdspInstrument as (instrumentId: DdspInstrumentId) => Promise<void>;
const renderInstrument = renderDdspInstrument as (input: {
    durationSec: number;
    instrumentId: DdspInstrumentId;
    notes: Array<{ durationSec: number; pitch: number; startSec: number; velocity: number }>;
    phraseId: string;
}) => Promise<{ audio: Float32Array; backend: string }>;
const storage = ddspModelStorage as {
    checkDdspInstrumentReady: (input: {
        id: string;
        version: string;
        artifacts: typeof admittedInstrument.artifacts;
    }) => Promise<boolean>;
};

type DdspProbe = {
    prepare: () => Promise<{ ready: boolean; artifactCount: number }>;
    renderOffline: () => Promise<{
        backend: string;
        pcmLength: number;
        finite: boolean;
        signature: DdspAudioSignature;
    }>;
};

type DdspAudioSignature = {
    activeRatio: number;
    crestFactor: number;
    meanAbsolute: number;
    middleRms: number;
    peak: number;
    rms: number;
    zeroCrossingRate: number;
};

function rmsBetween(audio: Float32Array, start: number, end: number): number {
    let squared = 0;
    for (let index = start; index < end; index += 1) {
        squared += audio[index] ** 2;
    }
    return Math.sqrt(squared / Math.max(1, end - start));
}

function audioSignature(audio: Float32Array): DdspAudioSignature {
    let absolute = 0;
    let active = 0;
    let peak = 0;
    let squared = 0;
    let crossings = 0;
    for (let index = 0; index < audio.length; index += 1) {
        const sample = audio[index];
        const magnitude = Math.abs(sample);
        absolute += magnitude;
        squared += sample ** 2;
        peak = Math.max(peak, magnitude);
        if (magnitude > 0.000_01) {
            active += 1;
        }
        if (index > 0 && sample < 0 !== audio[index - 1] < 0) {
            crossings += 1;
        }
    }
    const rms = Math.sqrt(squared / audio.length);
    return {
        activeRatio: active / audio.length,
        crestFactor: peak / Math.max(rms, Number.EPSILON),
        meanAbsolute: absolute / audio.length,
        middleRms: rmsBetween(audio, Math.floor(audio.length * 0.3), Math.floor(audio.length * 0.7)),
        peak,
        rms,
        zeroCrossingRate: crossings / Math.max(1, audio.length - 1),
    };
}

async function prepare(): Promise<{ ready: boolean; artifactCount: number }> {
    await removeInstrument(admittedInstrument.id);
    await downloadInstrument(admittedInstrument.id);
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

async function renderOffline(): Promise<{
    backend: string;
    pcmLength: number;
    finite: boolean;
    signature: DdspAudioSignature;
}> {
    inferenceWorkerBridge.terminateAll();
    if (!isDdspInstrumentId(admittedInstrument.id)) {
        throw new Error(`DDSP probe instrument is not callable: ${admittedInstrument.id}`);
    }
    const result = await renderInstrument({
        phraseId: `ddsp-probe-${crypto.randomUUID()}`,
        instrumentId: admittedInstrument.id,
        notes: [{ pitch: 69, velocity: 100, startSec: 0, durationSec: 0.4 }],
        durationSec: 0.5,
    });
    const finite = result.audio.length > 0 && result.audio.every(Number.isFinite);
    if (!finite) {
        throw new Error(`Invalid DDSP render: samples=${String(result.audio.length)}`);
    }
    return {
        backend: result.backend,
        pcmLength: result.audio.length,
        finite,
        signature: audioSignature(result.audio),
    };
}

Reflect.set(window, '__SOURDAW_DDSP_PROBE__', { prepare, renderOffline } satisfies DdspProbe);
