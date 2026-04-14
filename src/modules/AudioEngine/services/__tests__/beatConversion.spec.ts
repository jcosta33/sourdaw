import { describe, it, expect } from 'vitest';
import { beatToSeconds } from '../beatConversion';

describe('beatToSeconds', () => {
    it('should convert beats to seconds with a constant tempo', () => {
        const beat = 4;
        const defaultTempo = 120;
        const changes: any[] = [];
        
        // 4 beats at 120 bpm = 2 seconds
        expect(beatToSeconds(beat, defaultTempo, changes)).toBe(2);
    });

    it('should account for a single tempo change at beat 0', () => {
        const beat = 4;
        const defaultTempo = 120;
        const changes = [{ beat: 0, tempo: 60 }];
        
        // 4 beats at 60 bpm = 4 seconds
        expect(beatToSeconds(beat, defaultTempo, changes as any)).toBe(4);
    });

    it('should account for a tempo change midway', () => {
        const beat = 4;
        const defaultTempo = 120;
        const changes = [{ beat: 2, tempo: 60 }];
        
        // 0-2 beats at 120 bpm = 1 second
        // 2-4 beats at 60 bpm = 2 seconds
        // Total = 3 seconds
        expect(beatToSeconds(beat, defaultTempo, changes as any)).toBe(3);
    });

    it('should account for multiple tempo changes', () => {
        const beat = 6;
        const defaultTempo = 120;
        const changes = [
            { beat: 2, tempo: 60 },
            { beat: 4, tempo: 120 },
        ];
        
        // 0-2 beats at 120 bpm = 1 second
        // 2-4 beats at 60 bpm = 2 seconds
        // 4-6 beats at 120 bpm = 1 second
        // Total = 4 seconds
        expect(beatToSeconds(beat, defaultTempo, changes as any)).toBe(4);
    });

    it('should handle beats occurring exactly at a tempo change', () => {
        const beat = 2;
        const defaultTempo = 120;
        const changes = [{ beat: 2, tempo: 60 }];
        
        // 0-2 beats at 120 bpm = 1 second
        expect(beatToSeconds(beat, defaultTempo, changes as any)).toBe(1);
    });
});
