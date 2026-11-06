import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { handleSetClipFade } from '../clip/handleSetClipFade';
import { handleAddGainEnvelopePoint } from '../clipGainEnvelope/handleAddGainEnvelopePoint';
import { handleRemoveGainEnvelopePoint } from '../clipGainEnvelope/handleRemoveGainEnvelopePoint';
import { handleResetClipGainEnvelope } from '../clipGainEnvelope/handleResetClipGainEnvelope';
import { handleSetClipGainEnvelope } from '../clipGainEnvelope/handleSetClipGainEnvelope';
import { handleToggleClipGainEnvelope } from '../clipGainEnvelope/handleToggleClipGainEnvelope';

const mocks = vi.hoisted(() => ({
    clipType: 'midi' as 'midi' | 'audio',
    setClipFade: vi.fn(() => true),
    setEnvelope: vi.fn(),
    removeEnvelope: vi.fn(),
    toggleClipGainEnvelope: vi.fn(),
    addGainEnvelopePoint: vi.fn(),
    removeGainEnvelopePoint: vi.fn(),
    resetClipGainEnvelope: vi.fn(),
}));

vi.mock('../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: () => ({
        tracks: [{ id: 't1', clips: [{ id: 'c1', type: mocks.clipType, fadeInBeats: 0, fadeOutBeats: 0 }] }],
    }),
}));
vi.mock('../../useCases/clipEditing/setClipFade', () => ({ setClipFade: mocks.setClipFade }));
vi.mock('../../stores/gainEnvelopeStore', () => ({
    getEnvelope: vi.fn(),
    setEnvelope: mocks.setEnvelope,
    removeEnvelope: mocks.removeEnvelope,
}));
vi.mock('../../useCases/clipGainEnvelope/toggleClipGainEnvelope', () => ({
    toggleClipGainEnvelope: mocks.toggleClipGainEnvelope,
}));
vi.mock('../../useCases/clipGainEnvelope/addGainEnvelopePoint', () => ({
    addGainEnvelopePoint: mocks.addGainEnvelopePoint,
}));
vi.mock('../../useCases/clipGainEnvelope/removeGainEnvelopePoint', () => ({
    removeGainEnvelopePoint: mocks.removeGainEnvelopePoint,
}));
vi.mock('../../useCases/clipGainEnvelope/resetClipGainEnvelope', () => ({
    resetClipGainEnvelope: mocks.resetClipGainEnvelope,
}));

type Case = {
    name: string;
    run: () => unknown;
    writer: { mock: unknown };
};

const envelope = { clipId: 'c1', enabled: true, points: [{ id: 'p1', beatOffset: 0, gainDb: 0 }] };

const cases: Case[] = [
    {
        name: 'setClipFade',
        run: () =>
            handleSetClipFade.execute({
                type: 'setClipFade',
                payload: { clipId: 'c1', fadeInBeats: 1, fadeOutBeats: 1 },
            } satisfies AppAction),
        writer: mocks.setClipFade,
    },
    {
        name: 'toggleClipGainEnvelope',
        run: () =>
            handleToggleClipGainEnvelope.execute({
                type: 'toggleClipGainEnvelope',
                payload: { clipId: 'c1' },
            } satisfies AppAction),
        writer: mocks.toggleClipGainEnvelope,
    },
    {
        name: 'addGainEnvelopePoint',
        run: () =>
            handleAddGainEnvelopePoint.execute({
                type: 'addGainEnvelopePoint',
                payload: { clipId: 'c1', beatOffset: 1, gainDb: 0, pointId: 'p9' },
            } satisfies AppAction),
        writer: mocks.addGainEnvelopePoint,
    },
    {
        name: 'removeGainEnvelopePoint',
        run: () =>
            handleRemoveGainEnvelopePoint.execute({
                type: 'removeGainEnvelopePoint',
                payload: { clipId: 'c1', pointId: 'p1' },
            } satisfies AppAction),
        writer: mocks.removeGainEnvelopePoint,
    },
    {
        name: 'resetClipGainEnvelope',
        run: () =>
            handleResetClipGainEnvelope.execute({
                type: 'resetClipGainEnvelope',
                payload: { clipId: 'c1' },
            } satisfies AppAction),
        writer: mocks.resetClipGainEnvelope,
    },
    {
        name: 'setClipGainEnvelope',
        run: () =>
            handleSetClipGainEnvelope.execute({
                type: 'setClipGainEnvelope',
                payload: { clipId: 'c1', envelope },
            } satisfies AppAction),
        writer: mocks.setEnvelope,
    },
];

describe('fade and gain-envelope actions on a clip type', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe.each(cases)('$name', ({ run, writer }) => {
        it('refuses a MIDI clip without writing', () => {
            mocks.clipType = 'midi';

            expect(run()).toEqual({ status: 'no-write' });
            expect(writer.mock).toMatchObject({ calls: [] });
        });

        it('still writes an audio clip', () => {
            mocks.clipType = 'audio';

            const result = run();

            expect(result).not.toEqual({ status: 'no-write' });
            expect((writer.mock as { calls: unknown[] }).calls).toHaveLength(1);
        });
    });
});
