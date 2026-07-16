import { describe, it, expect } from 'vitest';

describe('Transport scheduling deep', () => {
    it('scheduleMidiNotes module loads', async () => {
        const mod = await import('../scheduleMidiNotes');
        expect(mod).toBeDefined();
    });
    it('scheduleAudioClips module loads', async () => {
        const mod = await import('../scheduleAudioClips');
        expect(mod).toBeDefined();
    });
    it('playheadScheduler module loads', async () => {
        const mod = await import('../../playheadScheduler');
        expect(mod).toBeDefined();
    });
});
