// The report analyzer reads exactly these WAV shapes; anything else is refused before storage opens.
const REPORT_SAMPLE_RATES: readonly number[] = [44100, 48000, 88200, 96000];

export const WAV_LOUDNESS_REPORT_REFUSAL =
    'WAV loudness reports need a Stems export whose delivery targets are WAV only, at 44.1, 48, 88.2 or 96 kHz, in mono or stereo.';

type ReportTarget = {
    readonly formats: readonly string[];
    readonly sampleRate: number;
    readonly channels: number;
};

function canReport(target: ReportTarget): boolean {
    return (
        target.formats.length === 1 &&
        target.formats[0] === 'wav' &&
        REPORT_SAMPLE_RATES.includes(target.sampleRate) &&
        (target.channels === 1 || target.channels === 2)
    );
}

/** Refuses a reported export the analyzer cannot attest; an unreported export always passes. */
export function validateWavLoudnessReportPlan(input: {
    includeWavLoudnessReports?: boolean;
    exportMode?: 'stems' | 'mixdown';
    targets?: readonly ReportTarget[];
}): void {
    if (!input.includeWavLoudnessReports) {
        return;
    }
    const targets = input.targets ?? [];
    if (input.exportMode !== 'stems' || targets.length === 0 || !targets.every(canReport)) {
        throw new Error(WAV_LOUDNESS_REPORT_REFUSAL);
    }
}
