import { describe, it, expect } from 'vitest';
import { activeRecordingRef } from '../activeRecordingRef';
import { clipDragPreviewRef } from '../clipDragPreviewRef';

describe('Arrangement ref stores', () => {
    it('activeRecordingRef should track recorded clip IDs', () => {
        expect(activeRecordingRef.current).toEqual([]);
        
        activeRecordingRef.current = ['clip-1', 'clip-2'];
        expect(activeRecordingRef.current).toContain('clip-1');
        
        activeRecordingRef.current = [];
        expect(activeRecordingRef.current).toHaveLength(0);
    });

    it('clipDragPreviewRef should track drag positions', () => {
        expect(clipDragPreviewRef.current).toBeNull();
        
        const preview = {
            positions: new Map([['c1', { trackId: 't1', startBeat: 0, endBeat: 4 }]]),
            originals: new Map([['c1', { trackId: 't1', startBeat: 0, endBeat: 4 }]]),
        };
        
        clipDragPreviewRef.current = preview;
        expect(clipDragPreviewRef.current?.positions.get('c1')?.trackId).toBe('t1');
        
        clipDragPreviewRef.current = null;
        expect(clipDragPreviewRef.current).toBeNull();
    });
});
