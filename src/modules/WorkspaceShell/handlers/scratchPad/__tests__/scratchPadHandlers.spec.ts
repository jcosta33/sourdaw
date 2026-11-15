import { describe, it, expect, vi, beforeEach } from 'vitest';

import { markerStore, scratchPadStore } from '#/modules/Arrangement/stores';
import { captureArrangementToScratchPad, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { workspaceStore } from '../../../stores/workspaceStore';
import { handleCaptureScratchPad } from '../handleCaptureScratchPad';
import { handleToggleScratchPad } from '../handleToggleScratchPad';

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        captureArrangementToScratchPad: vi.fn(actual.captureArrangementToScratchPad),
    };
});

vi.mock('../../../stores/workspaceStore', () => {
    const internal = { value: { scratchPadOpen: false } };
    return {
        workspaceStore: {
            get value() {
                return internal.value;
            },
            set: vi.fn((value) => {
                internal.value = value;
            }),
        },
    };
});

const handleRestoreScratchPadState = getArrangementHandlers().restoreScratchPadState;

type RestoreScratchPadStateAction = Extract<AppAction, { type: 'restoreScratchPadState' }>;

const markerSections = [
    { id: 'm1', startBeat: 8, endBeat: 16, name: 'Chorus', color: '#222222' },
    { id: 'm0', startBeat: 0, endBeat: 8, name: 'Verse', color: '#111111' },
];
const previousPad = [{ id: 'old-pad', startBeat: 0, endBeat: 4, name: 'Old', color: '#333333', order: 0 }];

describe('Workspace Scratch Pad Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workspaceStore.set({ scratchPadOpen: false } as any);
        scratchPadStore.set({ sections: [] });
        markerStore.set({ markers: [], sections: markerSections });
    });

    describe('handleCaptureScratchPad', () => {
        it('should capture arrangement and open the pad', () => {
            workspaceStore.set({ scratchPadOpen: false } as any);
            void handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: undefined });

            expect(captureArrangementToScratchPad).toHaveBeenCalled();
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: true }));
        });

        it('opens the pad expanded even if it was last closed while collapsed', () => {
            workspaceStore.set({ scratchPadOpen: false, scratchPadCollapsed: true } as any);
            void handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: undefined });

            expect(workspaceStore.set).toHaveBeenCalledWith(
                expect.objectContaining({ scratchPadOpen: true, scratchPadCollapsed: false })
            );
        });

        it('should capture arrangement and not toggle if already open', () => {
            workspaceStore.set({ scratchPadOpen: true } as any);
            vi.mocked(workspaceStore.set).mockClear();

            void handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: undefined });

            expect(captureArrangementToScratchPad).toHaveBeenCalled();
            expect(workspaceStore.set).not.toHaveBeenCalled();
        });
    });

    describe('handleCaptureScratchPad section ids', () => {
        function padIdsByOrder(): string[] {
            const sections = scratchPadStore.value?.sections ?? [];
            return sections.toSorted((left, right) => left.order - right.order).map((section) => section.id);
        }

        it('gives the captured sections the seeded ids in timeline order', () => {
            void handleCaptureScratchPad.execute({
                type: 'captureScratchPad',
                payload: { sectionIds: ['seed-verse', 'seed-chorus'] },
            });

            expect(scratchPadStore.value?.sections.map(({ id, name }) => ({ id, name }))).toEqual([
                { id: 'seed-verse', name: 'Verse' },
                { id: 'seed-chorus', name: 'Chorus' },
            ]);
        });

        it('mints a fresh id past the seeded ids and ignores a seeded id past the last section', () => {
            void handleCaptureScratchPad.execute({
                type: 'captureScratchPad',
                payload: { sectionIds: ['seed-verse'] },
            });
            const [verseId, chorusId] = padIdsByOrder();
            expect(verseId).toBe('seed-verse');
            expect(chorusId).toMatch(/^scratch-/);

            void handleCaptureScratchPad.execute({
                type: 'captureScratchPad',
                payload: { sectionIds: ['seed-verse', 'seed-chorus', 'seed-extra'] },
            });
            expect(padIdsByOrder()).toEqual(['seed-verse', 'seed-chorus']);
        });

        it('mints distinct fresh ids when the capture carries none', () => {
            void handleCaptureScratchPad.execute({ type: 'captureScratchPad', payload: undefined });

            const ids = padIdsByOrder();
            expect(ids).toHaveLength(2);
            expect(ids.every((id) => id.startsWith('scratch-'))).toBe(true);
            expect(new Set(ids).size).toBe(2);
        });

        it('materializes one fresh id per marker section, and keeps ids a capture already carries', () => {
            const action: Extract<AppAction, { type: 'captureScratchPad' }> = { type: 'captureScratchPad' };
            handleCaptureScratchPad.materializeCommandArguments?.(action);
            const minted = action.payload?.sectionIds ?? [];
            expect(minted).toHaveLength(markerSections.length);
            expect(minted.every((id) => id.startsWith('scratch-'))).toBe(true);
            expect(new Set(minted).size).toBe(markerSections.length);

            handleCaptureScratchPad.materializeCommandArguments?.(action);
            expect(action.payload?.sectionIds).toBe(minted);

            void handleCaptureScratchPad.execute(action);
            expect(padIdsByOrder()).toEqual(minted);
        });
    });

    describe('handleCaptureScratchPad materialized section ids', () => {
        function materialized(payload: { sectionIds?: string[] } | undefined): readonly string[] {
            const action: Extract<AppAction, { type: 'captureScratchPad' }> = { type: 'captureScratchPad', payload };
            handleCaptureScratchPad.materializeCommandArguments?.(action);
            return action.payload?.sectionIds ?? [];
        }

        it('fills an empty list to the marker count with distinct fresh ids', () => {
            const ids = materialized({ sectionIds: [] });
            expect(ids).toHaveLength(markerSections.length);
            expect(ids.every((id) => id.startsWith('scratch-'))).toBe(true);
            expect(new Set(ids).size).toBe(markerSections.length);
        });

        it('keeps a short list ids first and extends it to the marker count', () => {
            const ids = materialized({ sectionIds: ['pad-a'] });
            expect(ids).toHaveLength(markerSections.length);
            expect(ids[0]).toBe('pad-a');
            expect(ids[1]).toMatch(/^scratch-/);
        });

        it('leaves a list covering every marker or longer unchanged', () => {
            expect(materialized({ sectionIds: ['pad-a', 'pad-b'] })).toEqual(['pad-a', 'pad-b']);
            expect(materialized({ sectionIds: ['pad-a', 'pad-b', 'pad-c'] })).toEqual(['pad-a', 'pad-b', 'pad-c']);
        });

        it('writes exactly the filled ids and undoes to the prior pad', () => {
            scratchPadStore.set({ sections: previousPad });
            const action: Extract<AppAction, { type: 'captureScratchPad' }> = {
                type: 'captureScratchPad',
                payload: { sectionIds: ['pad-a'] },
            };
            handleCaptureScratchPad.materializeCommandArguments?.(action);
            const description = handleCaptureScratchPad.describe(action);
            void handleCaptureScratchPad.execute(action);

            expect(padIdsByOrder()).toEqual(action.payload?.sectionIds);
            expect(description.inverseAction).toEqual(
                expect.objectContaining({
                    payload: expect.objectContaining({
                        expectedSections: scratchPadStore.value?.sections,
                        replacementSections: previousPad,
                    }),
                })
            );
        });

        function padIdsByOrder(): string[] {
            const sections = scratchPadStore.value?.sections ?? [];
            return sections.toSorted((left, right) => left.order - right.order).map((section) => section.id);
        }
    });

    describe('handleCaptureScratchPad supplied section ids', () => {
        // Payloads from outside the app are shaped by nothing but their senders.
        function captureOf(payload: unknown): Extract<AppAction, { type: 'captureScratchPad' }> {
            return { type: 'captureScratchPad', payload } as Extract<AppAction, { type: 'captureScratchPad' }>;
        }
        const validationContext = { actions: [], actionIndex: 0 };

        const refused = [
            ['a repeated id', { sectionIds: ['x', 'x'] }],
            ['an empty id', { sectionIds: [''] }],
            ['a non-string id', { sectionIds: [42] }],
            ['a string in place of a list', { sectionIds: 'ab' }],
        ] as const;
        const accepted = [
            ['an absent payload', undefined],
            ['an empty payload', {}],
            ['unique non-empty ids', { sectionIds: ['pad-a', 'pad-b'] }],
            ['more ids than marker sections', { sectionIds: ['pad-a', 'pad-b', 'pad-c'] }],
        ] as const;

        it.each(refused)('validate refuses %s', (_label, payload) => {
            expect(handleCaptureScratchPad.validate?.(captureOf(payload), validationContext)).toBe(false);
        });

        it.each(accepted)('validate accepts %s', (_label, payload) => {
            expect(handleCaptureScratchPad.validate?.(captureOf(payload), validationContext)).toBe(true);
        });

        it.each(refused)('execute refuses %s before writing the pad or opening it', (_label, payload) => {
            scratchPadStore.set({ sections: previousPad });
            vi.mocked(workspaceStore.set).mockClear();

            const result = handleCaptureScratchPad.execute(captureOf(payload));

            expect(result).toEqual(expect.objectContaining({ status: 'conflict' }));
            expect(captureArrangementToScratchPad).not.toHaveBeenCalled();
            expect(scratchPadStore.value?.sections).toEqual(previousPad);
            expect(workspaceStore.set).not.toHaveBeenCalled();
        });

        it('stays out of combined batches, since its description snapshots the live pad', () => {
            expect(handleCaptureScratchPad.batchExecution).toBe('singleton');
        });
    });

    describe('handleCaptureScratchPad undo', () => {
        const action = { type: 'captureScratchPad' as const, payload: undefined };

        it('describe yields a restoreScratchPadState inverse', () => {
            const described = handleCaptureScratchPad.describe(action);
            expect(described.inverseAction?.type).toBe('restoreScratchPadState');
            expect(described.redoAction?.type).toBe('restoreScratchPadState');
        });

        it('undo restores the previous pad exactly (ids included); redo brings back the captured sections', () => {
            scratchPadStore.set({ sections: previousPad });
            const described = handleCaptureScratchPad.describe(action);
            void handleCaptureScratchPad.execute(action);

            const captured = scratchPadStore.value?.sections ?? [];
            expect(captured).toHaveLength(2);
            expect(captured.map((section) => section.id)).not.toContain('old-pad');

            const undo = handleRestoreScratchPadState.execute(described.inverseAction as RestoreScratchPadStateAction);
            expect(undo).toEqual({ status: 'written' });
            expect(scratchPadStore.value?.sections).toEqual(previousPad);
            expect(markerStore.value?.sections).toEqual(markerSections);

            const redo = handleRestoreScratchPadState.execute(described.redoAction as RestoreScratchPadStateAction);
            expect(redo).toEqual({ status: 'written' });
            expect(scratchPadStore.value?.sections).toEqual(captured);
        });

        it('yields a null inverse, isNoop and no write when the arrangement has no marker sections', () => {
            markerStore.set({ markers: [], sections: [] });
            scratchPadStore.set({ sections: previousPad });

            expect(handleCaptureScratchPad.describe(action).inverseAction).toBeNull();
            expect(handleCaptureScratchPad.isNoop?.(action)).toBe(true);
            expect(handleCaptureScratchPad.execute(action)).toEqual({ status: 'no-write' });
            expect(scratchPadStore.value?.sections).toEqual(previousPad);
        });
    });

    describe('handleToggleScratchPad', () => {
        it('should toggle from false to true', () => {
            workspaceStore.set({ scratchPadOpen: false } as any);
            void handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: undefined });
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: true }));
        });

        it('should toggle from true to false', () => {
            workspaceStore.set({ scratchPadOpen: true } as any);
            void handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: undefined });
            expect(workspaceStore.set).toHaveBeenCalledWith(expect.objectContaining({ scratchPadOpen: false }));
        });

        it('forgets the collapsed state when it closes the pad', () => {
            workspaceStore.set({ scratchPadOpen: true, scratchPadCollapsed: true } as any);
            void handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: undefined });
            expect(workspaceStore.set).toHaveBeenCalledWith(
                expect.objectContaining({ scratchPadOpen: false, scratchPadCollapsed: false })
            );
        });

        it('is a no-op when the workspace store value is null (guard branch)', () => {
            // Drive the store value to null via the mock setter, then clear
            // the call log so only post-null writes are counted.
            workspaceStore.set(null);
            vi.mocked(workspaceStore.set).mockClear();

            void handleToggleScratchPad.execute({ type: 'toggleScratchPad', payload: undefined });

            expect(workspaceStore.set).not.toHaveBeenCalled();
        });
    });
});
