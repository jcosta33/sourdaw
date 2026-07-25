import {
    applyExportNormalization,
    type ApplyExportNormalizationOutput,
} from '../repositories/audioEncoders/applyExportNormalization';

type NormalizeExportBufferInput = {
    buffer: AudioBuffer;
    targetLufs: number;
    ceilingDbTp: number;
};

/**
 * Normalize a rendered export to a loudness target under a true-peak ceiling.
 *
 * Public boundary over the normalization repository — consumers depend on this
 * use case rather than reaching into `repositories/audioEncoders/`.
 */
export function normalizeExportBuffer(input: NormalizeExportBufferInput): ApplyExportNormalizationOutput {
    return applyExportNormalization(input);
}
