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

const downloadInstrument = downloadDdspInstrument as (input: typeof admittedInstrument) => Promise<void>;
const removeInstrument = removeDdspInstrument as (input: typeof admittedInstrument) => Promise<void>;
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
    return { backend: result.backend, pcmLength: result.audio.length, finite };
}

Reflect.set(window, '__SOURDAW_DDSP_PROBE__', { prepare, renderOffline } satisfies DdspProbe);
