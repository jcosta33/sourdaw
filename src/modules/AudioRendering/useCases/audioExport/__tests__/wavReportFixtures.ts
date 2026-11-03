import { createHash } from 'node:crypto';

import { expect } from 'vitest';

import { toneSource } from '../../../repositories/audioEncoders/__tests__/oggCodecTestWorker';
import { resolveDeliveryTargets } from '../../resolveDeliveryTargets';
import { type streamExport } from '../streamExport';

type ExportTarget = Extract<Parameters<typeof streamExport>[0], { targets: unknown }>['targets'][number];

/** One 48 kHz stereo 24-bit WAV-only target, the shape a reported stems export accepts. */
export function wavReportTargets(overrides: Partial<ExportTarget> = {}): ExportTarget[] {
    return resolveDeliveryTargets({
        targets: [
            {
                id: 'custom',
                name: 'Custom',
                settings: {
                    formats: ['wav'],
                    sampleRate: 48000,
                    bitDepth: 24,
                    channels: 2,
                    mp3BitRate: 192,
                    normalization: 'off',
                    targetLufs: -14,
                    ceilingDbTp: -1,
                },
                dither: { mode: 'tpdf' },
            },
        ],
    }).map((target) => ({ ...target, ...overrides }));
}

/** Two WAV-only targets at different rates, so each report must name its own target and bytes. */
export function twoWavReportTargets(): ExportTarget[] {
    return wavReportTargets().flatMap((base) => [
        { ...base, id: 'a', name: 'A', sampleRate: 48000 },
        { ...base, id: 'b', name: 'B', sampleRate: 96000 },
    ]);
}

export function reportStem(extraFrames: number) {
    return toneSource(48000, 2, 48000 + extraFrames);
}

/** The report attests exactly the WAV bytes beside it, for its own stem and target. */
export function expectReportDescribes(
    reportBytes: Uint8Array,
    wav: Uint8Array,
    audioFile: string,
    stemId: string,
    target = { id: 'custom', sampleRate: 48000 }
): void {
    expect(wav.length).toBeGreaterThan(44);
    const report: unknown = JSON.parse(new TextDecoder().decode(reportBytes));
    expect(report).toMatchObject({
        measurementBasis: 'decoded-WAV-bytes',
        stemId,
        targetId: target.id,
        audioFile,
        wav: {
            channels: 2,
            sampleRate: target.sampleRate,
            bitDepth: 24,
            bytes: wav.length,
            md5: createHash('md5').update(wav).digest('hex'),
        },
        integrated: { value: expect.any(Number), unit: 'LUFS' },
        maxMomentary: { value: expect.any(Number), unit: 'LUFS' },
        maxShortTerm: { unit: 'LUFS' },
        truePeak: { value: expect.any(Number), unit: 'dBTP' },
    });
}
