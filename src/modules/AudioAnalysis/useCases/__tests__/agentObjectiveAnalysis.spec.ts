import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type AgentObjectiveAnalysisReceipt,
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricId,
    type AgentObjectiveMetricValue,
    type MeasuredAgentObjectiveAnalysisReceipt,
} from '../../models/AgentObjectiveAnalysisTypes';
import { analyzeAgentRenderReceipt } from '../analyzeAgentRenderReceipt';

const mocks = vi.hoisted(() => ({ getExactAgentSectionRenderArtifact: vi.fn() }));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    getExactAgentSectionRenderArtifact: mocks.getExactAgentSectionRenderArtifact,
}));

const SAMPLE_RATE = 48_000;
const TONE_HZ = 1000;
const CONTENT_ADDRESS = 'content-address-candidate';
const SOURCE_REVISION = 'revision-7';

const JOB = {
    jobId: 'job-1',
    sectionId: 'section-1',
    sectionName: 'Chorus',
    startBeat: 0,
    endBeat: 16,
    sampleRate: SAMPLE_RATE,
    tailSeconds: 0.5,
};

/**
 * The order every receipt reports its metrics in. Written out here rather than
 * imported so a receipt that quietly drops or reorders a metric fails, instead
 * of agreeing with whatever the production list happens to say.
 */
const EXPECTED_METRIC_IDS = [
    'samplePeak',
    'truePeak',
    'integratedLoudness',
    'shortTermLoudnessMax',
    'momentaryLoudnessMax',
    'rms',
    'crestFactor',
    'dynamicRangeEstimate',
    'dcOffset',
    'clippingCount',
    'silentFraction',
    'tailTruncation',
    'spectralCentroid',
    'spectralRolloff',
    'frequencyBandEnergy',
    'stereoCorrelation',
    'sideEnergyFraction',
    'lowFrequencyStereoContent',
    'transientDensity',
    'onsetTimes',
    'tempoAlignment',
    'phasePolarity',
    'interTrackMasking',
    'busHeadroom',
    'gainStagingAnomalies',
];

/**
 * A sine at a given dBFS peak, 1 kHz unless told otherwise. BS.1770 is
 * calibrated so a stereo 1 kHz sine reads its own peak level in LUFS, which is
 * what lets these expectations be absolute figures rather than comparisons
 * against the code's own output.
 */
function sineChannel(peakDbfs: number, length: number, toneHz = TONE_HZ, phase = 0): Float32Array {
    const amplitude = 10 ** (peakDbfs / 20);
    const samples = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        samples[index] = amplitude * Math.sin((2 * Math.PI * toneHz * index) / SAMPLE_RATE + phase);
    }
    return samples;
}

/** Digital silence until `startFrame`, then a sine of the given level to the end. */
function silentLeadInChannel(peakDbfs: number, length: number, startFrame: number): Float32Array {
    const samples = new Float32Array(length);
    const tone = sineChannel(peakDbfs, length);
    samples.set(tone.subarray(startFrame), startFrame);
    return samples;
}

/** A 1 kHz sine that steps from one level to another at `switchFrame`. */
function levelStepChannel(firstDbfs: number, secondDbfs: number, switchFrame: number, length: number): Float32Array {
    const first = 10 ** (firstDbfs / 20);
    const second = 10 ** (secondDbfs / 20);
    const samples = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        const amplitude = index < switchFrame ? first : second;
        samples[index] = amplitude * Math.sin((2 * Math.PI * TONE_HZ * index) / SAMPLE_RATE);
    }
    return samples;
}

/** A sine that changes both its frequency and its level at `switchFrame`. */
function toneStepChannel(
    first: { peakDbfs: number; toneHz: number },
    second: { peakDbfs: number; toneHz: number },
    switchFrame: number,
    length: number
): Float32Array {
    const samples = sineChannel(first.peakDbfs, length, first.toneHz);
    samples.set(sineChannel(second.peakDbfs, length, second.toneHz).subarray(switchFrame), switchFrame);
    return samples;
}

/** The elementwise sum of two channels of the same length. */
function mixChannels(first: Float32Array, second: Float32Array): Float32Array {
    return first.map((sample, index) => sample + (second[index] ?? 0));
}

/** The same channel with a constant added to every sample. */
function offsetChannel(channel: Float32Array, offset: number): Float32Array {
    return channel.map((sample) => sample + offset);
}

/** The same channel with one sample replaced by a value no meter can read. */
function corruptSample(channel: Float32Array, index: number, value: number): Float32Array {
    const corrupted = Float32Array.from(channel);
    corrupted[index] = value;
    return corrupted;
}

function invert(channel: Float32Array): Float32Array {
    return channel.map((sample) => -sample);
}

function constantChannel(value: number, length: number): Float32Array {
    return new Float32Array(length).fill(value);
}

function clickChannel(length: number, clickFrames: readonly number[]): Float32Array {
    const samples = new Float32Array(length);
    for (const frame of clickFrames) {
        samples[frame] = 0.9;
    }
    return samples;
}

function audioBuffer(channelData: readonly Float32Array[]): AudioBuffer {
    const length = channelData[0]?.length ?? 0;
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: channelData.length,
        duration: length / SAMPLE_RATE,
        getChannelData: (channel: number) => channelData[channel] ?? new Float32Array(length),
    } as unknown as AudioBuffer;
}

function retainArtifact(channelData: readonly Float32Array[], contentAddress = CONTENT_ADDRESS): void {
    const buffer = audioBuffer(channelData);
    mocks.getExactAgentSectionRenderArtifact.mockReturnValue({
        ...JOB,
        sourceRevision: SOURCE_REVISION,
        owner: 'agent-section-render',
        retention: 'session',
        renderedAt: 1_700_000_000_000,
        durationSeconds: buffer.length / SAMPLE_RATE,
        frameCount: buffer.length,
        channelCount: channelData.length,
        byteSize: buffer.length * channelData.length * 4,
        contentAddress,
        warnings: [],
        buffer,
    });
}

function analyze(
    channelData: readonly Float32Array[],
    options: { baseline?: MeasuredAgentObjectiveAnalysisReceipt; requestedContentAddress?: string } = {}
): AgentObjectiveAnalysisReceipt {
    retainArtifact(channelData);
    return analyzeAgentRenderReceipt({
        subject: {
            job: JOB,
            sourceRevision: SOURCE_REVISION,
            contentAddress: options.requestedContentAddress ?? CONTENT_ADDRESS,
        },
        baseline: options.baseline,
    });
}

function measuredReceipt(receipt: AgentObjectiveAnalysisReceipt): MeasuredAgentObjectiveAnalysisReceipt {
    if (receipt.status !== 'measured') {
        throw new Error(`Expected a measured receipt, got unavailable (${receipt.reason})`);
    }
    return receipt;
}

function entry(receipt: AgentObjectiveAnalysisReceipt, id: AgentObjectiveMetricId): AgentObjectiveMetricEntry {
    return measuredReceipt(receipt).measurements[id];
}

function metric(receipt: AgentObjectiveAnalysisReceipt, id: AgentObjectiveMetricId): number {
    const found = entry(receipt, id);
    if (found.status !== 'measured') {
        throw new Error(`Expected ${id} to be measured, got unavailable (${found.reason})`);
    }
    if (typeof found.value !== 'number') {
        throw new TypeError(`Expected ${id} to be a scalar`);
    }
    return found.value;
}

/** A per-band map, told apart from the receipt's other value shapes. */
function isBandMap(value: AgentObjectiveMetricValue): value is Readonly<Record<string, number>> {
    return typeof value === 'object' && !Array.isArray(value);
}

function bandEnergy(receipt: AgentObjectiveAnalysisReceipt, band: string): number {
    const found = entry(receipt, 'frequencyBandEnergy');
    if (found.status !== 'measured') {
        throw new Error(`Expected frequencyBandEnergy to be measured, got unavailable (${found.reason})`);
    }
    if (!isBandMap(found.value)) {
        throw new TypeError('Expected frequencyBandEnergy to be a per-band map');
    }
    const energy = found.value[band];
    if (typeof energy !== 'number') {
        throw new TypeError(`Expected a ${band} band energy`);
    }
    return energy;
}

beforeEach(() => {
    mocks.getExactAgentSectionRenderArtifact.mockReset();
});

describe('analyzeAgentRenderReceipt — refusals', () => {
    it('refuses when no retained artifact matches the job and revision', () => {
        mocks.getExactAgentSectionRenderArtifact.mockReturnValue(null);

        expect(
            analyzeAgentRenderReceipt({
                subject: { job: JOB, sourceRevision: SOURCE_REVISION, contentAddress: CONTENT_ADDRESS },
            })
        ).toEqual({ status: 'unavailable', reason: 'no-retained-artifact' });
    });

    it('refuses when the retained artifact is not the audio the caller named', () => {
        const receipt = analyze([sineChannel(-23, SAMPLE_RATE), sineChannel(-23, SAMPLE_RATE)], {
            requestedContentAddress: 'content-address-of-some-other-render',
        });

        expect(receipt).toEqual({ status: 'unavailable', reason: 'content-address-mismatch' });
    });
});

describe('analyzeAgentRenderReceipt — level, loudness and spectral measurements', () => {
    it('reads a -23 dBFS stereo sine as the figures a calibrated meter shows', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, tone]);

        expect(metric(receipt, 'integratedLoudness')).toBeCloseTo(-23, 1);
        expect(metric(receipt, 'momentaryLoudnessMax')).toBeCloseTo(-23, 1);
        expect(Math.abs(metric(receipt, 'samplePeak') - -23)).toBeLessThan(0.01);
        expect(Math.abs(metric(receipt, 'rms') - -26.01)).toBeLessThan(0.02);
        expect(Math.abs(metric(receipt, 'crestFactor') - 3.01)).toBeLessThan(0.02);
        expect(Math.abs(metric(receipt, 'stereoCorrelation') - 1)).toBeLessThan(1e-6);
        expect(Math.abs(metric(receipt, 'sideEnergyFraction'))).toBeLessThan(1e-6);
        expect(metric(receipt, 'dcOffset')).toBeLessThan(1e-4);
        expect(metric(receipt, 'clippingCount')).toBe(0);
        expect(metric(receipt, 'silentFraction')).toBe(0);
        expect(Math.abs(metric(receipt, 'spectralCentroid') - TONE_HZ)).toBeLessThan(60);
    });

    it('reports spectral rolloff in hertz, not in bins', () => {
        // meyda returns the centroid as a bin index and the rolloff already in
        // hertz. Converting the rolloff as if it were a bin puts a 1 kHz tone
        // near 25 kHz — above Nyquist for this render.
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, tone]);

        expect(metric(receipt, 'spectralRolloff')).toBeGreaterThan(900);
        expect(metric(receipt, 'spectralRolloff')).toBeLessThan(1500);
    });

    it('reads a polarity-inverted channel as fully out of phase', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, invert(tone)]);

        expect(Math.abs(metric(receipt, 'stereoCorrelation') - -1)).toBeLessThan(1e-6);
        expect(Math.abs(metric(receipt, 'sideEnergyFraction') - 1)).toBeLessThan(1e-6);
        // The two channels sum to nothing, so a spectrum read off a mono mix
        // would have no tone left to place.
        expect(Math.abs(metric(receipt, 'spectralCentroid') - TONE_HZ)).toBeLessThan(60);
    });

    it('reads the spectrum over every channel, so a tone in one channel is not missed', () => {
        // 1 kHz at -20 dBFS on the left, 8 kHz at -6 dBFS on the right. Weighing
        // each tone by its own amplitude puts the centroid at
        // (1000 * 0.1 + 8000 * 0.5) / 0.6 = 6833 Hz: channel 0 alone would place
        // it at 1 kHz, and weighing by energy rather than amplitude at 7732 Hz.
        const length = SAMPLE_RATE * 2;
        const receipt = analyze([sineChannel(-20, length), sineChannel(-6, length, 8000)]);

        expect(Math.abs(metric(receipt, 'spectralCentroid') - 6833)).toBeLessThan(150);
    });

    it('reads a tone that lives in one channel at its own frequency', () => {
        // Hard-panned 8 kHz with digital silence in the left channel. Half the
        // frames of the summed spectrum carry nothing, so a reading that divided
        // by the channel count would place the tone an octave low.
        const length = SAMPLE_RATE * 2;
        const receipt = analyze([new Float32Array(length), sineChannel(-6, length, 8000)]);

        expect(receipt.status).toBe('measured');
        expect(Math.abs(metric(receipt, 'spectralCentroid') - 8000)).toBeLessThan(100);
    });

    it('reports the rolloff at the 85 % energy point, not at the last audible tone', () => {
        // 1 kHz at 0 dBFS with 8 kHz at -10 dBFS under it: the 1 kHz tone holds
        // 91 % of the energy, so 85 % of it is reached at its own bin. A 99 %
        // fraction would walk past it and report 8 kHz.
        const length = SAMPLE_RATE * 2;
        const channel = mixChannels(sineChannel(0, length), sineChannel(-10, length, 8000));
        const receipt = analyze([channel, channel]);

        expect(Math.abs(metric(receipt, 'spectralRolloff') - TONE_HZ)).toBeLessThan(60);
    });

    it('weighs each frame by the level it carries rather than counting them alike', () => {
        // 2048 frames of 15 kHz at -120 dBFS, then 2048 frames of 1 kHz at
        // -6 dBFS. Normalising each frame by its own amplitude sum before
        // averaging erases the 114 dB between them and reports 8 kHz, the
        // midpoint of two tones only one of which is audible.
        const channel = toneStepChannel(
            { peakDbfs: -120, toneHz: 15_000 },
            { peakDbfs: -6, toneHz: TONE_HZ },
            2048,
            4096
        );
        const receipt = analyze([channel, channel]);

        expect(Math.abs(metric(receipt, 'spectralCentroid') - TONE_HZ)).toBeLessThan(60);
        expect(metric(receipt, 'spectralRolloff')).toBeLessThan(1200);
    });

    it('places a tone at its own frequency when the render carries a DC offset', () => {
        // Bin 0 holds the DC the receipt already reports as a level, not a
        // frequency the render sounds. Counted as a bin it drags a 1 kHz tone
        // with 0.05 of offset under it down to about 877 Hz.
        const channel = offsetChannel(sineChannel(-6, SAMPLE_RATE), 0.05);
        const receipt = analyze([channel, channel]);

        expect(Math.abs(metric(receipt, 'spectralCentroid') - TONE_HZ)).toBeLessThan(60);
        expect(Math.abs(metric(receipt, 'dcOffset') - 0.05)).toBeLessThan(1e-6);
    });

    it('keeps a DC offset out of the sub band as well as out of the centroid', () => {
        // A 1 kHz tone at -23 dBFS under 0.1 of constant offset. Meyda windows
        // every frame, and a window puts half of a constant in bin 1 rather
        // than leaving it all in bin 0, so excluding bin 0 alone would leave
        // the offset sounding as a 23 Hz tone louder than the tone itself.
        const channel = offsetChannel(sineChannel(-23, 96_000), 0.1);
        const receipt = analyze([channel, channel]);

        expect(Math.abs(metric(receipt, 'spectralCentroid') - TONE_HZ)).toBeLessThan(60);
        expect(bandEnergy(receipt, 'sub')).toBeLessThan(0.01);
    });

    it('has no spectrum to report for a render that is nothing but a constant offset', () => {
        // A steady 0.5 on both channels is a DC offset the receipt reports as a
        // level. It sounds no frequency at any length, so the spectral figures
        // are missing for the same reason silence makes them missing.
        const constant = constantChannel(0.5, 48_000);
        const receipt = analyze([constant, constant]);

        expect(entry(receipt, 'spectralCentroid')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(entry(receipt, 'spectralRolloff')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(entry(receipt, 'frequencyBandEnergy')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(Math.abs(metric(receipt, 'dcOffset') - 0.5)).toBeLessThan(1e-6);
    });

    it('shares band energy by the energy each frame carries, not by the square of its frame count', () => {
        // Half a second of 1 kHz at -6 dBFS, then 3.5 s of 12 kHz at -26 dBFS.
        // Per frame the 1 kHz passage carries a hundred times the energy, and
        // it holds about 94 % of the render's. Squaring a bin that was summed
        // over frames scales each band by the square of the frames it sounds
        // in, which hands the render to the long quiet passage.
        const channel = toneStepChannel(
            { peakDbfs: -6, toneHz: TONE_HZ },
            { peakDbfs: -26, toneHz: 12_000 },
            24_000,
            192_000
        );
        const receipt = analyze([channel, channel]);

        expect(Math.abs(bandEnergy(receipt, 'mid') - 0.935)).toBeLessThan(0.015);
        expect(Math.abs(metric(receipt, 'spectralRolloff') - TONE_HZ)).toBeLessThan(60);
    });

    it('leaves one full-scale frame above two hundred frames a hundredth of its amplitude', () => {
        // One 2048-sample frame of 1 kHz at 0 dBFS, then 200 frames of 12 kHz
        // at -40 dBFS. The loud frame holds ten thousand times the energy of
        // each faint one, so it keeps 98 % of the render's. Summing amplitude
        // over frames before squaring multiplies the faint passage by 200
        // first, which leaves it four times the loud frame.
        const channel = toneStepChannel(
            { peakDbfs: 0, toneHz: TONE_HZ },
            { peakDbfs: -40, toneHz: 12_000 },
            2048,
            411_648
        );
        const receipt = analyze([channel, channel]);

        expect(Math.abs(bandEnergy(receipt, 'mid') - 0.98)).toBeLessThan(0.01);
    });

    it('reads the spectrum off the frames that carry audio, not off the silent ones', () => {
        // Two analysis frames: the first is digital silence, which meyda reports
        // as a NaN centroid and a rolloff above Nyquist because it divides by
        // the frame's own amplitude sum. Both are numbers, so a summing loop
        // that only checks the type carries them into the mean.
        const length = 4096;
        const channel = silentLeadInChannel(-6, length, 2048);
        const receipt = analyze([channel, channel]);

        expect(Math.abs(metric(receipt, 'spectralCentroid') - TONE_HZ)).toBeLessThan(60);
        expect(metric(receipt, 'spectralRolloff')).toBeLessThan(2000);
    });

    it('reads band energy past the first spectrum window, so a silent lead-in does not decide it', () => {
        // Silence over the whole first 8192 frames, then a full-scale 1 kHz
        // tone: a profile taken from that opening window alone finds no energy.
        const length = SAMPLE_RATE * 2;
        const channel = silentLeadInChannel(0, length, 8192);
        const receipt = analyze([channel, channel]);

        expect(bandEnergy(receipt, 'mid')).toBeGreaterThan(0.9);
    });

    it('reads a single loud channel 3 dB below the same tone in both', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, new Float32Array(SAMPLE_RATE * 2)]);

        expect(metric(receipt, 'integratedLoudness')).toBeCloseTo(-26, 1);
    });

    it('measures a DC offset rather than hiding it in the level', () => {
        const receipt = analyze([constantChannel(0.5, SAMPLE_RATE * 2), constantChannel(0.5, SAMPLE_RATE * 2)]);

        expect(Math.abs(metric(receipt, 'dcOffset') - 0.5)).toBeLessThan(1e-6);
        expect(Math.abs(metric(receipt, 'samplePeak') - -6.02)).toBeLessThan(0.01);
    });

    it('counts every sample pinned at full scale', () => {
        const clipped = sineChannel(-23, SAMPLE_RATE * 2);
        for (let index = 1000; index < 2000; index++) {
            clipped[index] = 1;
        }
        const receipt = analyze([clipped, sineChannel(-23, SAMPLE_RATE * 2)]);

        expect(metric(receipt, 'clippingCount')).toBe(1000);
    });

    it('reports silence as silence instead of measuring -inf dBFS', () => {
        const silence = new Float32Array(SAMPLE_RATE);
        const receipt = analyze([silence, silence]);

        expect(entry(receipt, 'integratedLoudness')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(entry(receipt, 'samplePeak')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(entry(receipt, 'stereoCorrelation')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(entry(receipt, 'spectralCentroid')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(metric(receipt, 'silentFraction')).toBe(1);
        expect(metric(receipt, 'clippingCount')).toBe(0);
    });

    it('separates programme below the absolute gate from silence', () => {
        // -90 dBFS carries samples a peak meter reads, but BS.1770's -70 LUFS
        // absolute gate accepts no block, so there is no integrated figure.
        const faint = sineChannel(-90, SAMPLE_RATE * 2);
        const receipt = analyze([faint, faint]);

        expect(entry(receipt, 'integratedLoudness')).toEqual({ status: 'unavailable', reason: 'below-gate' });
        expect(Math.abs(metric(receipt, 'samplePeak') - -90)).toBeLessThan(0.01);
    });

    it('reports material too short to gate as too short, not as silent', () => {
        const fragment = sineChannel(-23, 100);
        const receipt = analyze([fragment, fragment]);

        expect(entry(receipt, 'integratedLoudness')).toEqual({ status: 'unavailable', reason: 'too-short' });
        expect(entry(receipt, 'shortTermLoudnessMax')).toEqual({ status: 'unavailable', reason: 'too-short' });
        expect(entry(receipt, 'momentaryLoudnessMax')).toEqual({ status: 'unavailable', reason: 'too-short' });
        expect(entry(receipt, 'spectralCentroid')).toEqual({ status: 'unavailable', reason: 'too-short' });
        // `measureProgramAudio` reads no frame at this length and returns a
        // dynamic range of 0, which is a missing measurement, not a flat render.
        expect(entry(receipt, 'dynamicRangeEstimate')).toEqual({ status: 'unavailable', reason: 'too-short' });
    });

    it('reads band energy from every whole analysis frame a short render has', () => {
        // 4800 frames carries two 2048-frame analysis frames: enough to place a
        // 1 kHz tone in the 500-2000 Hz band.
        const fragment = sineChannel(-23, 4800);
        const receipt = analyze([fragment, fragment]);

        expect(bandEnergy(receipt, 'mid')).toBeGreaterThan(0.9);
        expect(Math.abs(metric(receipt, 'spectralCentroid') - TONE_HZ)).toBeLessThan(60);
    });

    it('reads a hit that lands past the last whole analysis frame', () => {
        // 4000 samples hold one whole 2048-sample frame, and the hit at sample
        // 3000 lives in the 1952 that follow it. Stopping at whole frames
        // leaves a render that plainly carries a transient with no spectrum.
        const click = clickChannel(4000, [3000]);
        const receipt = analyze([click, click]);

        expect(entry(receipt, 'spectralCentroid').status).toBe('measured');
        expect(Number.isFinite(metric(receipt, 'spectralCentroid'))).toBe(true);
    });

    it('weighs the trailing partial frame by the samples it actually carries', () => {
        // One whole frame of 1 kHz then half a frame of 6 kHz, both at
        // -6 dBFS. Half a frame passes half the window's energy, so the 1 kHz
        // frame keeps two thirds of the render; padding the remainder out to a
        // whole frame of tone instead would split it evenly.
        const channel = toneStepChannel({ peakDbfs: -6, toneHz: TONE_HZ }, { peakDbfs: -6, toneHz: 6000 }, 2048, 3072);
        const receipt = analyze([channel, channel]);

        expect(Math.abs(bandEnergy(receipt, 'mid') - 0.667)).toBeLessThan(0.05);
    });

    it('refuses band energy for a render shorter than one analysis frame', () => {
        const fragment = sineChannel(-23, 1000);
        const receipt = analyze([fragment, fragment]);

        expect(entry(receipt, 'frequencyBandEnergy')).toEqual({ status: 'unavailable', reason: 'too-short' });
    });

    it('calls a silent render silent rather than short, however few frames it has', () => {
        // Every other metric answers silence before length. A spectrum that
        // answered length first would blame the 1000 frames for a reading the
        // silence in them denied at any length.
        const silence = new Float32Array(1000);
        const receipt = analyze([silence, silence]);

        expect(entry(receipt, 'spectralCentroid')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(entry(receipt, 'spectralRolloff')).toEqual({ status: 'unavailable', reason: 'silent' });
        expect(entry(receipt, 'frequencyBandEnergy')).toEqual({ status: 'unavailable', reason: 'silent' });
    });

    it('has no silent fraction to report for a render with no frames', () => {
        const receipt = analyze([new Float32Array(0), new Float32Array(0)]);

        expect(entry(receipt, 'silentFraction')).toEqual({ status: 'unavailable', reason: 'too-short' });
    });

    it('has no stereo relationship to report for a mono render', () => {
        const receipt = analyze([sineChannel(-23, SAMPLE_RATE * 2)]);

        expect(entry(receipt, 'stereoCorrelation')).toEqual({ status: 'unavailable', reason: 'mono' });
        expect(entry(receipt, 'sideEnergyFraction')).toEqual({ status: 'unavailable', reason: 'mono' });
    });
});

describe('analyzeAgentRenderReceipt — windowed loudness maxima', () => {
    it('reads each windowed maximum over its own window, not over the whole render', () => {
        // 3.6 s at -30 dBFS then 0.4 s at -14 dBFS. The loudest 3 s window holds
        // 0.4 s of the loud passage and 2.6 s of the quiet one; the loudest
        // 400 ms window holds the loud passage alone.
        const length = SAMPLE_RATE * 4;
        const channel = levelStepChannel(-30, -14, Math.round(3.6 * SAMPLE_RATE), length);
        const receipt = analyze([channel, channel]);

        const shortTerm = 10 * Math.log10(0.4 / 3 + (2.6 / 3) * 10 ** -1.6) - 14;
        expect(Math.abs(metric(receipt, 'shortTermLoudnessMax') - shortTerm)).toBeLessThan(0.15);
        expect(Math.abs(metric(receipt, 'momentaryLoudnessMax') - -14)).toBeLessThan(0.1);
    });

    it('refuses a short-term maximum over a render shorter than its 3 s window', () => {
        // Taken over 2 s the figure would be a momentary-scale reading wearing a
        // short-term label, and 2 s of -23 dBFS would agree with it by accident.
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, tone]);

        expect(entry(receipt, 'shortTermLoudnessMax')).toEqual({ status: 'unavailable', reason: 'too-short' });
        expect(Math.abs(metric(receipt, 'momentaryLoudnessMax') - -23)).toBeLessThan(0.05);
    });
});

describe('analyzeAgentRenderReceipt — peaks, pooled level and correlation', () => {
    it('reads a true peak above the sample peak for a tone the samples miss', () => {
        // 12 kHz at a 45 degree phase offset: every sample lands 3 dB below the
        // waveform's own peak, which only a reconstructing meter recovers.
        const tone = sineChannel(-23, SAMPLE_RATE * 2, 12_000, Math.PI / 4);
        const receipt = analyze([tone, tone]);

        expect(Math.abs(metric(receipt, 'samplePeak') - -26.02)).toBeLessThan(0.05);
        expect(Math.abs(metric(receipt, 'truePeak') - -23)).toBeLessThan(0.6);
        expect(metric(receipt, 'truePeak') - metric(receipt, 'samplePeak')).toBeGreaterThan(2);
    });

    it('pools rms over every channel, so a silent channel lowers the reading', () => {
        // One -23 dBFS sine and one silent channel: the sine's own rms is
        // -26.01 dBFS, and pooling it with silence halves the power.
        const receipt = analyze([sineChannel(-23, SAMPLE_RATE * 2), new Float32Array(SAMPLE_RATE * 2)]);

        expect(Math.abs(metric(receipt, 'rms') - -29.02)).toBeLessThan(0.02);
        expect(Math.abs(metric(receipt, 'crestFactor') - 6.02)).toBeLessThan(0.02);
    });

    it('reads channels of unequal level but identical shape as fully correlated', () => {
        const length = SAMPLE_RATE * 2;
        const receipt = analyze([sineChannel(-23, length), sineChannel(-29, length)]);

        expect(Math.abs(metric(receipt, 'stereoCorrelation') - 1)).toBeLessThan(1e-6);
    });

    it('reads two identical DC channels as fully correlated rather than undefined', () => {
        const receipt = analyze([constantChannel(0.5, SAMPLE_RATE * 2), constantChannel(0.5, SAMPLE_RATE * 2)]);

        expect(Math.abs(metric(receipt, 'stereoCorrelation') - 1)).toBeLessThan(1e-6);
    });
});

describe('analyzeAgentRenderReceipt — non-finite samples', () => {
    it.each([
        ['an infinity', Number.POSITIVE_INFINITY],
        ['a NaN', Number.NaN],
    ])('reads every metric off finite samples when the render carries %s', (_label, corruption) => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([corruptSample(tone, 1000, corruption), tone]);

        expect(Math.abs(metric(receipt, 'samplePeak') - -23)).toBeLessThan(0.01);
        expect(Number.isFinite(metric(receipt, 'rms'))).toBe(true);
        expect(Math.abs(metric(receipt, 'rms') - -26.01)).toBeLessThan(0.05);
        expect(metric(receipt, 'dcOffset')).toBeLessThan(1e-4);
    });
});

describe('analyzeAgentRenderReceipt — transients', () => {
    it('places onsets on the samples that actually attack', () => {
        const length = SAMPLE_RATE * 2;
        const clicks = clickChannel(length, [SAMPLE_RATE / 2, (SAMPLE_RATE * 3) / 2]);
        const receipt = analyze([clicks, clicks]);

        // The flux detector fires on the frame whose energy rose, which is one
        // window (about 31 ms here) before the click itself.
        expect(entry(receipt, 'onsetTimes')).toEqual({
            status: 'measured',
            metricVersion: 1,
            unit: 'seconds',
            confidence: 'estimated',
            value: [expect.closeTo(0.5, 2), expect.closeTo(1.5, 2)],
        });
        expect(Math.abs(metric(receipt, 'transientDensity') - 1)).toBeLessThan(0.05);
    });

    it('hears an attack that lives in one channel only', () => {
        // A hard-panned hit is absent from channel 0, so onsets read there alone
        // would report an empty list for a render that plainly has one.
        const length = SAMPLE_RATE * 2;
        const receipt = analyze([new Float32Array(length), clickChannel(length, [SAMPLE_RATE])]);

        expect(entry(receipt, 'onsetTimes')).toEqual({
            status: 'measured',
            metricVersion: 1,
            unit: 'seconds',
            confidence: 'estimated',
            value: [expect.closeTo(1, 2)],
        });
        expect(Math.abs(metric(receipt, 'transientDensity') - 0.5)).toBeLessThan(0.05);
    });
});

describe('analyzeAgentRenderReceipt — comparison against a baseline receipt', () => {
    it('subtracts scalars, names loudness deltas in LU, and refuses the rest', () => {
        const quiet = sineChannel(-23, SAMPLE_RATE * 2);
        const baseline = measuredReceipt(analyze([quiet, quiet]));
        const loud = sineChannel(-20, SAMPLE_RATE * 2);
        const candidate = measuredReceipt(analyze([loud, loud], { baseline }));

        const comparison = candidate.comparison;
        if (!comparison) {
            throw new Error('Expected a comparison against the baseline receipt');
        }
        expect(comparison.baseline).toEqual({
            contentAddress: CONTENT_ADDRESS,
            sourceRevision: SOURCE_REVISION,
        });
        expect(comparison.metrics.integratedLoudness).toEqual({
            status: 'compared',
            delta: expect.closeTo(3, 1),
            unit: 'LU',
        });
        expect(comparison.metrics.samplePeak).toEqual({
            status: 'compared',
            delta: expect.closeTo(3, 2),
            unit: 'dB',
        });
        expect(Object.keys(comparison.metrics)).toEqual(EXPECTED_METRIC_IDS);
        expect(comparison.metrics.onsetTimes).toEqual({ status: 'incomparable', reason: 'non-scalar' });
        expect(comparison.metrics.tempoAlignment).toEqual({
            status: 'incomparable',
            reason: 'candidate-unavailable',
        });
    });

    it('refuses to subtract a baseline figure that is not a finite number', () => {
        // A baseline is data an earlier run wrote, so a NaN or an infinity can
        // reach this comparison; subtracting either yields a delta that is not
        // a difference between two measurements.
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const earlier = measuredReceipt(analyze([tone, tone]));
        const corruptPeak: AgentObjectiveMetricEntry = {
            status: 'measured',
            metricVersion: 1,
            unit: 'dBFS',
            value: Number.NaN,
            confidence: 'exact',
        };
        const baseline: MeasuredAgentObjectiveAnalysisReceipt = {
            ...earlier,
            measurements: { ...earlier.measurements, samplePeak: corruptPeak },
        };

        const candidate = measuredReceipt(analyze([tone, tone], { baseline }));

        expect(candidate.comparison?.metrics.samplePeak).toEqual({ status: 'incomparable', reason: 'non-scalar' });
    });

    it('refuses to compare a baseline written against another schema version', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const baseline = measuredReceipt(analyze([tone, tone]));
        const futureBaseline = { ...baseline, schemaVersion: 2 } as unknown as MeasuredAgentObjectiveAnalysisReceipt;

        const receipt = measuredReceipt(analyze([tone, tone], { baseline: futureBaseline }));

        expect(receipt.comparison).toBeNull();
        expect(receipt.warnings).toHaveLength(1);
    });

    it('carries no comparison and no warning when no baseline was supplied', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = measuredReceipt(analyze([tone, tone]));

        expect(receipt.comparison).toBeNull();
        expect(receipt.warnings).toEqual([]);
    });
});

describe('analyzeAgentRenderReceipt — receipt shape', () => {
    it('binds the receipt to the render it read and reports every metric id', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = measuredReceipt(analyze([tone, tone]));

        expect(receipt.schemaVersion).toBe(1);
        expect(receipt.subject.contentAddress).toBe(CONTENT_ADDRESS);
        expect(receipt.subject.sourceRevision).toBe(SOURCE_REVISION);
        expect(receipt.subject.jobId).toBe(JOB.jobId);
        expect(receipt.subject.sectionName).toBe(JOB.sectionName);
        expect(receipt.subject.frameCount).toBe(SAMPLE_RATE * 2);
        expect(receipt.subject.channelCount).toBe(2);
        expect(Object.keys(receipt.measurements)).toEqual(EXPECTED_METRIC_IDS);
        expect(Date.parse(receipt.analyzedAt)).not.toBeNaN();
    });

    it('types what it cannot measure instead of estimating it', () => {
        const tone = sineChannel(-23, SAMPLE_RATE * 2);
        const receipt = analyze([tone, tone]);

        expect(entry(receipt, 'lowFrequencyStereoContent')).toEqual({
            status: 'unavailable',
            reason: 'not-implemented',
        });
        expect(entry(receipt, 'phasePolarity')).toEqual({ status: 'unavailable', reason: 'needs-multitrack' });
        expect(entry(receipt, 'interTrackMasking')).toEqual({ status: 'unavailable', reason: 'needs-multitrack' });
        expect(entry(receipt, 'busHeadroom')).toEqual({ status: 'unavailable', reason: 'needs-project-state' });
        expect(entry(receipt, 'gainStagingAnomalies')).toEqual({
            status: 'unavailable',
            reason: 'needs-project-state',
        });
    });
});
