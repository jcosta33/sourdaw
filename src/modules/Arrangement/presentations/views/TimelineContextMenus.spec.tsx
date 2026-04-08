import { describe, it, expect } from 'vitest';
import { ClipContextMenu } from './ClipContextMenu';
import { TimelineEmptyMenu } from './TimelineEmptyMenu';

describe('TimelineContextMenus exports', () => {
    it('should export ClipContextMenu', () => {
        expect(ClipContextMenu).toBeDefined();
        expect(typeof ClipContextMenu).toBe('function');
    });

    it('should export TimelineEmptyMenu', () => {
        expect(TimelineEmptyMenu).toBeDefined();
        expect(typeof TimelineEmptyMenu).toBe('function');
    });
});
