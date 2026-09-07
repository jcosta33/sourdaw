import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getTrackStrip } from '../../engineAccess/getTrackStrip';
import { importScoringTuning } from '../importScoringTuning';

vi.mock('../../engineAccess/getTrackStrip', () => ({
    getTrackStrip: vi.fn(),
}));

describe('importScoringTuning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns ok: false when track strip does not exist', async () => {
        vi.mocked(getTrackStrip).mockReturnValue(undefined);

        const result = await importScoringTuning('t1', 'd1', 'scala', 'some-text');
        expect(result).toEqual({ ok: false });
    });

    it('returns ok: false when device node does not exist or has no scoringControls', async () => {
        vi.mocked(getTrackStrip).mockReturnValue({
            deviceNodes: [{ deviceId: 'd2' }],
        } as unknown as ReturnType<typeof getTrackStrip>);

        const result = await importScoringTuning('t1', 'd1', 'scala', 'some-text');
        expect(result).toEqual({ ok: false });

        vi.mocked(getTrackStrip).mockReturnValue({
            deviceNodes: [{ deviceId: 'd1' }],
        } as unknown as ReturnType<typeof getTrackStrip>);

        const result2 = await importScoringTuning('t1', 'd1', 'scala', 'some-text');
        expect(result2).toEqual({ ok: false });
    });

    it('routes scala import to scoringControls.importScala', async () => {
        const importScala = vi.fn().mockResolvedValue({ ok: true, name: 'Just Intonation' });
        const importTun = vi.fn();
        vi.mocked(getTrackStrip).mockReturnValue({
            deviceNodes: [
                {
                    deviceId: 'd1',
                    scoringControls: { importScala, importTun },
                },
            ],
        } as unknown as ReturnType<typeof getTrackStrip>);

        const result = await importScoringTuning('t1', 'd1', 'scala', 'scl-content');
        expect(importScala).toHaveBeenCalledWith('scl-content');
        expect(importTun).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: true, name: 'Just Intonation' });
    });

    it('routes tun import to scoringControls.importTun', async () => {
        const importScala = vi.fn();
        const importTun = vi.fn().mockResolvedValue({ ok: true, name: 'AnaMark tuning' });
        vi.mocked(getTrackStrip).mockReturnValue({
            deviceNodes: [
                {
                    deviceId: 'd1',
                    scoringControls: { importScala, importTun },
                },
            ],
        } as unknown as ReturnType<typeof getTrackStrip>);

        const result = await importScoringTuning('t1', 'd1', 'tun', 'tun-content');
        expect(importTun).toHaveBeenCalledWith('tun-content');
        expect(importScala).not.toHaveBeenCalled();
        expect(result).toEqual({ ok: true, name: 'AnaMark tuning' });
    });
});
