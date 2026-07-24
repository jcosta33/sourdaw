import { type ExportFormat } from './exportSettings';

export type ExportBitDepth = 16 | 24 | 32;

export type ResolveExportBitDepthsInput = {
    formats: ReadonlySet<ExportFormat>;
    selectedBitDepth: number;
};

export type ResolveExportBitDepthsOutput = {
    /** Depths the current format selection can actually deliver. */
    availableBitDepths: readonly ExportBitDepth[];
    /** The selection, clamped into the available set. */
    bitDepth: ExportBitDepth;
};

const ALL_BIT_DEPTHS: readonly ExportBitDepth[] = [16, 24, 32];

/**
 * FLAC here writes 16- or 24-bit subframes; 32-bit float has no lossless FLAC
 * representation. The depth control therefore stops offering 32-bit while FLAC
 * is selected instead of accepting the choice and quietly emitting something
 * else (OE-8) — an unsupported option is removed, never silently downgraded.
 */
const FLAC_BIT_DEPTHS: readonly ExportBitDepth[] = [16, 24];

function isExportBitDepth(value: number): value is ExportBitDepth {
    return value === 16 || value === 24 || value === 32;
}

/**
 * Resolve which bit depths the chosen formats support, and which one the export
 * will actually use.
 */
export function resolveExportBitDepths(input: ResolveExportBitDepthsInput): ResolveExportBitDepthsOutput {
    const availableBitDepths = input.formats.has('flac') ? FLAC_BIT_DEPTHS : ALL_BIT_DEPTHS;

    if (isExportBitDepth(input.selectedBitDepth) && availableBitDepths.includes(input.selectedBitDepth)) {
        return { availableBitDepths, bitDepth: input.selectedBitDepth };
    }

    // Highest depth the selection can honour, so removing an option never
    // downgrades further than it has to.
    return { availableBitDepths, bitDepth: availableBitDepths[availableBitDepths.length - 1]! };
}
