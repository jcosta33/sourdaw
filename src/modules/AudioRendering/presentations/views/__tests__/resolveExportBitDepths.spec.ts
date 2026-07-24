import { describe, it, expect } from 'vitest';

import { type ExportFormat } from '../exportSettings';
import { resolveExportBitDepths } from '../resolveExportBitDepths';

function formatsOf(...formats: ExportFormat[]): ReadonlySet<ExportFormat> {
    return new Set(formats);
}

describe('resolveExportBitDepths', () => {
    it('should offer every depth when FLAC is not selected', () => {
        const result = resolveExportBitDepths({ formats: formatsOf('wav', 'mp3'), selectedBitDepth: 32 });

        expect(result.availableBitDepths).toEqual([16, 24, 32]);
        expect(result.bitDepth).toBe(32);
    });

    it('should withdraw 32-bit while FLAC is selected', () => {
        const result = resolveExportBitDepths({ formats: formatsOf('wav', 'flac'), selectedBitDepth: 32 });

        expect(result.availableBitDepths).toEqual([16, 24]);
        expect(result.bitDepth).toBe(24);
    });

    it('should keep a supported selection untouched when FLAC is selected', () => {
        const result = resolveExportBitDepths({ formats: formatsOf('flac'), selectedBitDepth: 16 });

        expect(result.bitDepth).toBe(16);
    });

    it('should fall back to the highest available depth for a persisted value it cannot honour', () => {
        const result = resolveExportBitDepths({ formats: formatsOf('wav'), selectedBitDepth: 99 });

        expect(result.bitDepth).toBe(32);
    });
});
