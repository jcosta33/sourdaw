import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { scheduleMetronome } from './scheduleMetronome';
import { defaultTransportState } from '../../models/TransportState';

describe('scheduleMetronome', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not schedule clicks when the metronome is off', () => {
        const scheduleClick = vi.fn();
        injectDependencies(scheduleMetronome, {
            tempoMapStore: { value: { changes: [] } },
            timeSignatureMapStore: { value: { changes: [] } },
            getTempoAtBeat: vi.fn(() => 120),
            getCurrentTime: vi.fn(() => 0),
            scheduleClick,
            getTimeSignatureAtBeat: vi.fn(() => ({ numerator: 4, denominator: 4 })),
        });

        scheduleMetronome(0, 4, 0, { ...defaultTransportState, metronomeEnabled: false }, 120);

        expect(scheduleClick).not.toHaveBeenCalled();
    });
});
