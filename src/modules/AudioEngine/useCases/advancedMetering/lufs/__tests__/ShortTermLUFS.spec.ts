import { describe, it, expect } from 'vitest';
import { ShortTermLUFS } from '../ShortTermLUFS';

describe('ShortTermLUFS', () => {
    it('maintains a sliding window of 3s (approx 8 blocks)', () => {
        const lufs = new ShortTermLUFS(48000);
        
        // Push 10 blocks of -10 LUFS
        for (let i = 0; i < 10; i++) {
            lufs.push(-10);
        }
        
        expect(lufs.value).toBeCloseTo(-10, 1);
    });

    it('shifts out old blocks', () => {
        const lufs = new ShortTermLUFS(48000); // maxBlocks = 8
        
        lufs.push(-100); // Should be shifted out
        for (let i = 0; i < 8; i++) {
            lufs.push(-10);
        }
        
        // Only the eight -10 values should remain
        expect(lufs.value).toBeCloseTo(-10, 1);
    });

    it('returns -70 if empty', () => {
        const lufs = new ShortTermLUFS();
        expect(lufs.value).toBe(-70);
    });
});
