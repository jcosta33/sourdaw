import { describe, it, expect, vi } from 'vitest';

import { type GrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { loadGrandBouleAttackClip } from '../loadGrandBouleAttackClip';

function fakeEngine(engineRate: number): {
    handle: GrandBouleEngineHandle;
    loadAttackClip: ReturnType<typeof vi.fn>;
} {
    const loadAttackClip = vi.fn();
    return {
        loadAttackClip,
        handle: {
            noteOn: vi.fn(),
            noteOnMidi2: vi.fn(),
            noteOff: vi.fn(),
            setParam: vi.fn(),
            setSustain: vi.fn(),
            setUnaCorda: vi.fn(),
            setSostenuto: vi.fn(),
            setTemperament: vi.fn(),
            loadAttackClip,
            allNotesOff: vi.fn(),
            isReady: () => true,
            getAnalyserNode: () => null,
            sampleRate: () => engineRate,
        },
    };
}

describe('loadGrandBouleAttackClip', () => {
    it('resamples a 48 kHz clip to the 44.1 kHz engine rate before forwarding', () => {
        const { handle, loadAttackClip } = fakeEngine(44100);
        const clip = new Float32Array(480); // 10 ms at 48 kHz

        loadGrandBouleAttackClip({ engine: handle, key: 40, samples: clip, sourceSampleRate: 48000 });

        expect(loadAttackClip).toHaveBeenCalledTimes(1);
        const forwarded = loadAttackClip.mock.calls[0]?.[0] as { key: number; samples: Float32Array };
        // 10 ms of audio is preserved: the buffer is now the engine rate's worth
        // of frames, not the 48 kHz count — so it plays at the right pitch.
        expect(forwarded.samples).not.toBe(clip);
        expect(forwarded.samples.length).toBe(Math.round(480 * (44100 / 48000)));
        expect(forwarded.samples.length).toBe(441);
    });

    it('forwards a same-rate clip unchanged (no needless resampling)', () => {
        const { handle, loadAttackClip } = fakeEngine(48000);
        const clip = new Float32Array(480);

        loadGrandBouleAttackClip({ engine: handle, key: 40, samples: clip, sourceSampleRate: 48000 });

        const forwarded = loadAttackClip.mock.calls[0]?.[0] as { key: number; samples: Float32Array };
        expect(forwarded.samples).toBe(clip);
        expect(forwarded.samples.length).toBe(480);
    });

    it('ignores out-of-range keys without touching the engine', () => {
        const { handle, loadAttackClip } = fakeEngine(44100);
        const clip = new Float32Array(480);

        loadGrandBouleAttackClip({ engine: handle, key: 0, samples: clip, sourceSampleRate: 48000 });
        loadGrandBouleAttackClip({ engine: handle, key: 89, samples: clip, sourceSampleRate: 48000 });

        expect(loadAttackClip).not.toHaveBeenCalled();
    });
});
