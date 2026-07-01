import { describe, expect, it, vi } from 'vitest';

import { pickGrinderNeuralModelFiles } from '../pickGrinderNeuralModelFiles';

describe('pickGrinderNeuralModelFiles', () => {
    it('should call the provided picker with Grinder neural capture filters', async () => {
        const selected_files = [new File(['{}'], 'capture.nam')];
        const pick_files = vi.fn(() => Promise.resolve(selected_files));

        const result = await pickGrinderNeuralModelFiles({ pick_files });

        expect(result).toBe(selected_files);
        expect(pick_files).toHaveBeenCalledExactlyOnceWith({
            multiple: true,
            filters: [{ name: 'Neural captures', extensions: ['nam', 'json'] }],
        });
    });

    it('should preserve a cancelled picker result', async () => {
        const pick_files = vi.fn(() => Promise.resolve(null));

        const result = await pickGrinderNeuralModelFiles({ pick_files });

        expect(result).toBeNull();
        expect(pick_files).toHaveBeenCalledExactlyOnceWith({
            multiple: true,
            filters: [{ name: 'Neural captures', extensions: ['nam', 'json'] }],
        });
    });
});
