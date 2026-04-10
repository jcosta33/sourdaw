import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setVcaGain } from './setVcaGain';

describe('setVcaGain', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('clamps gain and writes groups via injected setters', () => {
        const setGroups = vi.fn();
        injectDependencies(setVcaGain, {
            getVcaGroupsState: () => [
                { id: 'g1', name: 'A', gain: 1, muted: false, trackIds: [] },
                { id: 'g2', name: 'B', gain: 0.5, muted: false, trackIds: [] },
            ],
            setVcaGroupsState: setGroups,
        });

        setVcaGain('g1', 3);

        expect(setGroups).toHaveBeenCalledTimes(1);
        const next = setGroups.mock.calls[0]![0] as { id: string; gain: number }[];
        expect(next.find((g) => g.id === 'g1')!.gain).toBe(2);
        expect(next.find((g) => g.id === 'g2')!.gain).toBe(0.5);
    });
});
