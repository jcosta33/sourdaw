import { type ZipExtractionLimits } from '#/infra/archive/extractGuardedZip';

/**
 * DAWproject archives bundle XML manifests plus a modest number of embedded
 * audio stems; they are not the primary channel for large audio libraries.
 * 64 MiB comfortably covers dozens of compressed or short-form stems while
 * capping the worst case the guard must tolerate: a compressed archive at
 * this ceiling can expand to at most 64 MiB of decoded bytes, not the 2 GiB
 * the shared guard's default allows (issue #3317 — a ~21 MB payload legally
 * expanding to 2 GiB via the guard's default compression-ratio allowance).
 * 512 entries is generous for a realistic project's XML + audio/ layout
 * while remaining far below the shared guard's 10,000-entry default.
 */
const DAW_PROJECT_ZIP_MAX_BYTES = 64 * 1024 * 1024;

export const DAW_PROJECT_ZIP_LIMITS = {
    maxArchiveBytes: DAW_PROJECT_ZIP_MAX_BYTES,
    maxTotalUncompressedBytes: DAW_PROJECT_ZIP_MAX_BYTES,
    maxEntryUncompressedBytes: DAW_PROJECT_ZIP_MAX_BYTES,
    maxEntries: 512,
} satisfies Partial<ZipExtractionLimits>;
