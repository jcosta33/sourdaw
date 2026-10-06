import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentReferenceStore } from '#/modules/AiRuntime/stores';
import { clearAgentReference, loadAgentReference } from '#/modules/AiRuntime/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { getAudioBufferContentAddress } from '#/utils/agentRenderReceipt';

import { analyzeAgentReferenceBuffer } from '../analyzeAgentReferenceBuffer';
import { compareAgentReferenceToProject } from '../compareAgentReferenceToProject';
import { compareAgentScopeMeasurements } from '../compareAgentScopeMeasurements';
import { getAgentMeasurementMetricIds } from '../getAgentMeasurementMetricIds';
import { measureAgentScopeRender } from '../measureAgentScopeRender';

const mocks = vi.hoisted(() => ({
    pickFiles: vi.fn(),
    decodeAudioFileBuffer: vi.fn(),
    decodeAudioFile: vi.fn(),
    cacheAudioBuffer: vi.fn(),
}));

// Only the picker and the decoder are replaced. The caching decode and the cache write are replaced
// too, so a switch to either is seen as a call rather than as a decode that happened to work.
vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    pickFiles: mocks.pickFiles,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFileBuffer: mocks.decodeAudioFileBuffer,
    decodeAudioFile: mocks.decodeAudioFile,
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

const SAMPLE_RATE = 48_000;
const TONE_HZ = 1000;
const REFERENCE_FILE_NAME = 'Private Mix Master v3.wav';
/** What one per-band map may carry: one number for each of the seven frequency bands. */
const MAX_BAND_VALUES = 7;

function sineBuffer(amplitude: number, seconds = 2): AudioBuffer {
    const length = SAMPLE_RATE * seconds;
    const channel = new Float32Array(length);
    for (let frame = 0; frame < length; frame++) {
        channel[frame] = amplitude * Math.sin((2 * Math.PI * TONE_HZ * frame) / SAMPLE_RATE);
    }
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: 2,
        duration: length / SAMPLE_RATE,
        getChannelData: () => channel,
    } as unknown as AudioBuffer;
}

function referenceFile(): File {
    return new File([new Uint8Array(8)], REFERENCE_FILE_NAME);
}

function isAudioBufferLike(value: unknown): boolean {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { getChannelData?: unknown }).getChannelData === 'function'
    );
}

/** A typed array, a whole buffer, a sample-sized number series, or an encoded blob anywhere in the value. */
function containsSampleData(value: unknown): boolean {
    if (ArrayBuffer.isView(value) || isAudioBufferLike(value)) {
        return true;
    }
    if (typeof value === 'string') {
        return /^[A-Za-z0-9+/]{256,}={0,2}$/u.test(value);
    }
    if (Array.isArray(value)) {
        const isNumberSeries = value.length > MAX_BAND_VALUES && value.every((entry) => typeof entry === 'number');
        return isNumberSeries || value.some(containsSampleData);
    }
    if (typeof value === 'object' && value !== null) {
        return Object.entries(value).some(
            ([key, entry]) => /^(samples?|pcm|audio|buffer|channeldata)$/iu.test(key) || containsSampleData(entry)
        );
    }
    return false;
}

function integratedLoudnessDelta(deltas: ReturnType<typeof compareAgentReferenceToProject>): number {
    const delta = deltas.integratedLoudness;
    if (delta?.status !== 'compared') {
        throw new Error(`Expected a compared integrated loudness, got ${JSON.stringify(delta)}`);
    }
    return delta.delta;
}

beforeEach(() => {
    for (const mock of Object.values(mocks)) {
        mock.mockReset();
    }
    clearAgentReference();
});

afterEach(() => {
    vi.restoreAllMocks();
    clearAgentReference();
});

describe('a reference file measured for the agent', () => {
    // Red when the reference is measured with fewer or other metrics than the agent measurement set.
    it('measures a reference buffer with exactly the agent metric ids and keeps its shape', () => {
        const analysis = analyzeAgentReferenceBuffer(sineBuffer(0.5));

        expect(Object.keys(analysis.measurements)).toEqual([...getAgentMeasurementMetricIds()]);
        expect(analysis).toMatchObject({
            sampleRate: SAMPLE_RATE,
            frameCount: SAMPLE_RATE * 2,
            channelCount: 2,
            durationSeconds: 2,
        });
        expect(analysis.measurements).toEqual(measureAgentScopeRender(sineBuffer(0.5), getAgentMeasurementMetricIds()));
        expect(containsSampleData(analysis)).toBe(false);
    });

    // Red when the detector stops flagging each way a sample can ride in a stored record.
    it('would catch a typed array, a whole buffer, a number series or an encoded blob in a record', () => {
        expect(containsSampleData({ levels: new Float32Array([0.1]) })).toBe(true);
        expect(containsSampleData({ held: sineBuffer(0.5) })).toBe(true);
        expect(containsSampleData({ levels: Array.from({ length: 1_024 }, () => 0.1) })).toBe(true);
        expect(containsSampleData({ blob: 'A'.repeat(512) })).toBe(true);
        expect(containsSampleData({ samples: [0.25] })).toBe(true);
        expect(containsSampleData({ loudness: { low: -12, mid: -18, high: -24 } })).toBe(false);
    });

    // Red when the stored record keeps anything beyond identity, display name, figures and shape.
    it('stores the base name, a content address, the figures and the shape of the decoded file, and no samples', async () => {
        const buffer = sineBuffer(0.5);
        mocks.pickFiles.mockResolvedValue([referenceFile()]);
        mocks.decodeAudioFileBuffer.mockResolvedValue(buffer);

        const result = await loadAgentReference();

        expect(result).toEqual({ status: 'loaded' });
        const stored = agentReferenceStore.value?.reference;
        if (stored === null || stored === undefined) {
            throw new Error('Expected a reference to be stored.');
        }
        expect(Object.keys(stored).toSorted()).toEqual(
            [
                'channelCount',
                'contentAddress',
                'durationSeconds',
                'frameCount',
                'measurements',
                'name',
                'referenceId',
                'sampleRate',
            ].toSorted()
        );
        expect(stored.name).toBe(REFERENCE_FILE_NAME);
        expect(stored.contentAddress).toBe(await getAudioBufferContentAddress(buffer));
        expect(stored.measurements).toEqual(analyzeAgentReferenceBuffer(buffer).measurements);
        expect(containsSampleData(stored)).toBe(false);
        expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledTimes(1);
    });

    // Red when the reference reaches the shared buffer cache or the caching decode.
    it('never lets the reference buffer into audioBufferCache or the caching decode path', async () => {
        const cacheSet = vi.spyOn(audioBufferCache, 'set');
        mocks.pickFiles.mockResolvedValue([referenceFile()]);
        mocks.decodeAudioFileBuffer.mockResolvedValue(sineBuffer(0.5));

        await loadAgentReference();

        const stored = agentReferenceStore.value?.reference;
        expect(cacheSet).not.toHaveBeenCalled();
        expect(audioBufferCache.has(stored?.contentAddress ?? 'missing')).toBe(false);
        expect(audioBufferCache.has(stored?.referenceId ?? 'missing')).toBe(false);
        expect(mocks.decodeAudioFile).not.toHaveBeenCalled();
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    // Red when a file that cannot be decoded still leaves a reference, or disturbs the earlier one.
    it('shows a decode failure as a typed result and stores nothing, leaving an earlier reference as it was', async () => {
        mocks.pickFiles.mockResolvedValue([referenceFile()]);
        mocks.decodeAudioFileBuffer.mockRejectedValueOnce(new Error('Unable to decode "x" — format not supported.'));

        expect(await loadAgentReference()).toEqual({ status: 'failed', reason: 'undecodable-audio' });
        expect(agentReferenceStore.value?.reference).toBeNull();

        mocks.decodeAudioFileBuffer.mockResolvedValueOnce(sineBuffer(0.5));
        await loadAgentReference();
        const earlier = agentReferenceStore.value?.reference;
        expect(earlier).not.toBeNull();

        mocks.decodeAudioFileBuffer.mockRejectedValueOnce(new Error('broken'));
        expect(await loadAgentReference()).toEqual({ status: 'failed', reason: 'undecodable-audio' });
        expect(agentReferenceStore.value?.reference).toBe(earlier);
    });

    // Red when a load that finishes after "Clear reference" brings the reference back.
    it('drops a reference whose load finishes after the user cleared it', async () => {
        let finishDecode: (buffer: AudioBuffer) => void = () => undefined;
        mocks.pickFiles.mockResolvedValue([referenceFile()]);
        mocks.decodeAudioFileBuffer.mockReturnValue(
            new Promise<AudioBuffer>((resolve) => {
                finishDecode = resolve;
            })
        );

        const pending = loadAgentReference();
        await vi.waitFor(() => {
            expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledTimes(1);
        });
        clearAgentReference();
        finishDecode(sineBuffer(0.5));

        expect(await pending).toEqual({ status: 'superseded' });
        expect(agentReferenceStore.value?.reference).toBeNull();
    });

    // Red when a slower earlier load overwrites the reference a newer load already stored.
    it('drops a reference whose load a newer load overtook', async () => {
        let finishFirstDecode: (buffer: AudioBuffer) => void = () => undefined;
        mocks.pickFiles.mockResolvedValue([referenceFile()]);
        mocks.decodeAudioFileBuffer
            .mockReturnValueOnce(
                new Promise<AudioBuffer>((resolve) => {
                    finishFirstDecode = resolve;
                })
            )
            .mockResolvedValueOnce(sineBuffer(0.25));

        const first = loadAgentReference();
        await vi.waitFor(() => {
            expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledTimes(1);
        });
        expect(await loadAgentReference()).toEqual({ status: 'loaded' });
        const newer = agentReferenceStore.value?.reference;
        finishFirstDecode(sineBuffer(0.5));

        expect(await first).toEqual({ status: 'superseded' });
        expect(agentReferenceStore.value?.reference).toBe(newer);
    });

    // Red when a dismissed picker stores anything or decodes anything.
    it('stores nothing when the user cancels the picker', async () => {
        mocks.pickFiles.mockResolvedValue(null);

        expect(await loadAgentReference()).toEqual({ status: 'cancelled' });
        expect(agentReferenceStore.value?.reference).toBeNull();
        expect(mocks.decodeAudioFileBuffer).not.toHaveBeenCalled();
    });

    // Red when a reference past the file or duration bound is decoded or kept.
    it.each([
        ['a file past the size bound', 'file-too-large'],
        ['audio past the duration bound', 'too-long'],
        ['audio with no frames', 'empty-audio'],
    ] as const)('refuses %s before storing a reference', async (_label, reason) => {
        const file = referenceFile();
        if (reason === 'file-too-large') {
            Object.defineProperty(file, 'size', { value: 300 * 1024 * 1024 });
        }
        mocks.pickFiles.mockResolvedValue([file]);
        if (reason === 'too-long') {
            mocks.decodeAudioFileBuffer.mockResolvedValue({ ...sineBuffer(0.5, 1), duration: 21 * 60 });
        } else {
            mocks.decodeAudioFileBuffer.mockResolvedValue({ ...sineBuffer(0.5, 1), length: 0 });
        }

        expect(await loadAgentReference()).toEqual({ status: 'failed', reason });
        expect(agentReferenceStore.value?.reference).toBeNull();
        if (reason === 'file-too-large') {
            expect(mocks.decodeAudioFileBuffer).not.toHaveBeenCalled();
        }
    });
});

describe('the delta between a reference and a project', () => {
    const referenceFigures = analyzeAgentReferenceBuffer(sineBuffer(0.5)).measurements;
    const projectFigures = analyzeAgentReferenceBuffer(sineBuffer(0.25)).measurements;

    // Red when the delta is project minus reference instead of reference minus project.
    it('equals compareAgentScopeMeasurements with the project as baseline and the reference as preview', () => {
        const deltas = compareAgentReferenceToProject({ project: projectFigures, reference: referenceFigures });

        expect(deltas).toEqual(compareAgentScopeMeasurements({ baseline: projectFigures, preview: referenceFigures }));
    });

    // Red when the sign flips: a reference 6 dB louder than the project is a positive loudness delta.
    it('is positive when the reference is louder than the project', () => {
        const louder = compareAgentReferenceToProject({ project: projectFigures, reference: referenceFigures });
        const quieter = compareAgentReferenceToProject({ project: referenceFigures, reference: projectFigures });

        expect(integratedLoudnessDelta(louder)).toBeCloseTo(6.02, 1);
        expect(integratedLoudnessDelta(quieter)).toBeCloseTo(-6.02, 1);
    });

    // Red when a per-band map is given a number instead of a typed reason.
    it('gives a per-band map no delta and names why', () => {
        const deltas = compareAgentReferenceToProject({ project: projectFigures, reference: referenceFigures });

        expect(deltas.frequencyBandEnergy).toEqual({ status: 'incomparable', reason: 'non-scalar' });
    });
});
