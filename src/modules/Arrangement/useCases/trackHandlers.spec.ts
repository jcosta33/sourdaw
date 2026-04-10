import { describe, it, expect } from 'vitest';
import { handleAddTrack } from '../handlers/track/handleAddTrack';

describe('track command handlers', () => {
    it('handleAddTrack is a wired ActionHandler', () => {
        expect(handleAddTrack.execute).toBeDefined();
        expect(handleAddTrack.describe).toBeDefined();
        expect(handleAddTrack.undoable).toBe(true);
    });
});
