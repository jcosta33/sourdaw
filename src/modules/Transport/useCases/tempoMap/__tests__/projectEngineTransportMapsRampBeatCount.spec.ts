import { beforeEach, describe, expect, it, vi } from 'vitest';

import { secondsBetweenBeats } from '../../../models/TempoMap';
import { defaultTransportState } from '../../../models/TransportState';
import { getTransportState } from '../../../repositories/transport/getTransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { projectEngineTransportMaps } from '../projectEngineTransportMaps';

vi.mock('../../../repositories/transport/getTransportState', () => ({
    getTransportState: vi.fn(),
}));

const tempoChange = (beat: number, tempo: number, curve: 'instant' | 'linear' = 'instant') => ({
    id: `tempo-${beat}`,
    beat,
    tempo,
    curve,
});

/**
 * Beats the native engine counts at `seconds`, integrated the way
 * `TempoMap::new`/`beats_at` in `crates/daw-engine/src/transport_map.rs` do:
 * each segment contributes its span at its own constant BPM.
 */
function engineBeatsAt(segments: readonly { startSeconds: number; beatsPerMinute: number }[], seconds: number): number {
    let beats = 0;
    for (let index = 0; index < segments.length; index++) {
        const segment = segments[index]!;
        if (segment.startSeconds >= seconds) {
            break;
        }
        const spanEnd = Math.min(seconds, segments[index + 1]?.startSeconds ?? seconds);
        beats += ((spanEnd - segment.startSeconds) * segment.beatsPerMinute) / 60;
    }
    return beats;
}

// Audit #4591 — the native engine derives song position (the arpeggiator step
// clock and hosted plugins' musical position) by integrating the projected
// segments. Each ramp segment sits at the exact second its beat is reached, so
// its BPM must make the segment span exactly its beats.
describe('projectEngineTransportMaps — beat count across a tempo ramp', () => {
    beforeEach(() => {
        vi.mocked(getTransportState).mockReturnValue({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        timeSignatureMapStore.set({ changes: [] });
    });

    it('reaches beat 4 at the second the arrangement reaches beat 4 after a 120 → 240 ramp', () => {
        const changes = [tempoChange(0, 120, 'linear'), tempoChange(4, 240)];
        tempoMapStore.set({ changes });

        const maps = projectEngineTransportMaps();
        const secondsAtBeatFour = secondsBetweenBeats(changes, 0, 4, 120);

        expect(engineBeatsAt(maps.tempo, secondsAtBeatFour)).toBeCloseTo(4, 6);
    });

    it('stays aligned to the arrangement long after the ramp', () => {
        const changes = [tempoChange(0, 120, 'linear'), tempoChange(4, 240)];
        tempoMapStore.set({ changes });

        const maps = projectEngineTransportMaps();
        const secondsAtBeatSixtyFour = secondsBetweenBeats(changes, 0, 64, 120);

        expect(engineBeatsAt(maps.tempo, secondsAtBeatSixtyFour)).toBeCloseTo(64, 6);
    });
});
