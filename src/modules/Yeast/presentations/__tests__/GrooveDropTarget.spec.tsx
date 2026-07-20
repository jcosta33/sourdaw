import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { createGrooveTemplate, getMidiGrooveHandlers, setMidiStoreState } from '#/modules/MIDI/useCases';

import { GrooveDropTarget } from '../views/GrooveDropTarget';

function createTrackState(): TrackStoreState {
    return {
        tracks: [
            {
                id: 'track-source',
                name: 'Source track',
                kind: 'midi',
                muted: false,
                soloed: false,
                armed: false,
                gain: 1,
                pan: 0,
                color: '#abcdef',
                clips: [
                    {
                        id: 'clip-source',
                        trackId: 'track-source',
                        name: 'Source clip',
                        startBeat: 0,
                        endBeat: 4,
                        type: 'midi',
                        fadeInBeats: 0,
                        fadeOutBeats: 0,
                        gain: 1,
                        color: '#abcdef',
                        locked: false,
                        muted: false,
                    },
                ],
                devices: [],
                sends: [],
                midiFx: [],
                frozen: false,
                freezeState: { status: 'unfrozen' },
                parentId: null,
                collapsed: false,
                inputMonitoring: 'auto',
                hidden: false,
                disabled: false,
                height: 80,
                outputId: 'master',
                automationMode: 'read',
                groupId: null,
                soloSafe: false,
                notes: '',
                inputId: null,
                activeAlternativeId: 'main',
                alternatives: [],
                vcaGroupId: null,
                midiOutputTrackId: null,
                followChordTrack: false,
            },
        ],
        selectedTrackId: 'track-source',
        ghostClips: [],
    };
}

function createDataTransfer(clipId: string): Pick<DataTransfer, 'getData'> {
    return {
        getData: (type) => (type === 'application/x-sourdaw-midi-clip' ? clipId : ''),
    };
}

describe('GrooveDropTarget', () => {
    beforeEach(() => {
        const document: Record<string, unknown> = {};
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: (input) => input.changeFn(document),
            waitForSnapshotTransaction: () => Promise.resolve(),
        });
        clearHandlerRegistry();
        registerHandlerMap(getMidiGrooveHandlers());
        clearUndoHistory();
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        trackStore.set(createTrackState());
        setMidiStoreState({
            notesByClipId: {
                'clip-source': [{ id: 'late', pitch: 60, startBeat: 0.02, duration: 0.25, velocity: 96 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        flushAutomergeStorageWrites();
        clearUndoHistory();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearUndoHistory();
        clearHandlerRegistry();
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('previews a dropped MIDI clip and commits extraction as one undoable shared write', async () => {
        render(<GrooveDropTarget />);

        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });

        expect(await screen.findByText('Previewing “Source clip groove”')).toBeInTheDocument();
        expect(grooveTemplateStore.value?.templates.some((template) => template.id === 'groove-clip-source-v1')).toBe(
            false
        );

        fireEvent.click(screen.getByRole('button', { name: 'Save groove' }));

        await waitFor(() => {
            expect(
                grooveTemplateStore.value?.templates.some((template) => template.id === 'groove-clip-source-v1')
            ).toBe(true);
        });
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Extract groove template']);
    });

    it('offers an accessible MIDI clip selection path without requiring drag and drop', async () => {
        render(<GrooveDropTarget />);

        fireEvent.change(screen.getByRole('combobox', { name: 'MIDI clip for groove extraction' }), {
            target: { value: 'clip-source' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Preview groove' }));

        expect(await screen.findByText('Previewing “Source clip groove”')).toBeInTheDocument();
    });

    it('clears a stale proposal when the extraction subdivision changes', async () => {
        const view = render(<GrooveDropTarget subdivision="1/16" />);
        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        await screen.findByText('Previewing “Source clip groove”');

        view.rerender(<GrooveDropTarget subdivision="1/32" />);

        await waitFor(() => {
            expect(screen.queryByText('Previewing “Source clip groove”')).not.toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: 'Save groove' })).not.toBeInTheDocument();
    });

    it('locks proposal replacement while the displayed proposal is being saved', async () => {
        let resolveTransaction: (() => void) | undefined;
        configureAutomergeStoragePort({
            getDoc: () => ({}),
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: (input) => input.changeFn({}),
            waitForSnapshotTransaction: () =>
                new Promise<void>((resolve) => {
                    resolveTransaction = resolve;
                }),
        });
        render(<GrooveDropTarget />);
        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        await screen.findByText('Previewing “Source clip groove”');

        fireEvent.click(screen.getByRole('button', { name: 'Save groove' }));
        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('missing-clip'),
        });

        expect(screen.getByText('Previewing “Source clip groove”')).toBeInTheDocument();
        expect(screen.queryByText(/missing-clip/)).not.toBeInTheDocument();
        resolveTransaction?.();
        await waitFor(() => {
            expect(screen.queryByText('Previewing “Source clip groove”')).not.toBeInTheDocument();
        });
    });

    it('cancels a proposal without a catalog write or undo entry', async () => {
        render(<GrooveDropTarget />);

        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        await screen.findByText('Previewing “Source clip groove”');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByText('Previewing “Source clip groove”')).not.toBeInTheDocument();
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects confirmation when the displayed source notes changed', async () => {
        render(<GrooveDropTarget />);
        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        await screen.findByText('Previewing “Source clip groove”');

        setMidiStoreState({
            notesByClipId: {
                'clip-source': [{ id: 'late', pitch: 60, startBeat: 0.04, duration: 0.25, velocity: 96 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save groove' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The source clip changed. Preview the groove again before saving.'
        );
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('rejects confirmation when the displayed source notes were deleted', async () => {
        render(<GrooveDropTarget />);
        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        await screen.findByText('Previewing “Source clip groove”');

        setMidiStoreState({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        fireEvent.click(screen.getByRole('button', { name: 'Save groove' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The source clip changed. Preview the groove again before saving.'
        );
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
        expect(undoStore.value?.past).toEqual([]);
    });

    it('shows and commits a collision-resolved name while an identical retry remains a no-write', async () => {
        createGrooveTemplate({
            id: 'occupied-name',
            name: 'Source clip groove',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'occupied-name' },
        });
        render(<GrooveDropTarget />);

        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        expect(await screen.findByText('Previewing “Source clip groove 2”')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save groove' }));

        await waitFor(() => {
            expect(grooveTemplateStore.value?.templates).toContainEqual(
                expect.objectContaining({ id: 'groove-clip-source-v1', name: 'Source clip groove 2' })
            );
        });
        expect(undoStore.value?.past).toHaveLength(1);

        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        expect(await screen.findByText('Previewing “Source clip groove 2”')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save groove' }));

        await waitFor(() => {
            expect(screen.queryByText('Previewing “Source clip groove 2”')).not.toBeInTheDocument();
        });
        expect(undoStore.value?.past).toHaveLength(1);
    });

    it('distinguishes a stale proposal from a template identity conflict', async () => {
        const firstView = render(<GrooveDropTarget />);
        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        await screen.findByText('Previewing “Source clip groove”');
        createGrooveTemplate({
            id: 'occupied-name',
            name: 'Source clip groove',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'occupied-name' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save groove' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'The groove library changed. Preview the groove again before saving.'
        );
        firstView.unmount();

        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        createGrooveTemplate({
            id: 'groove-clip-source-v1',
            name: 'Source clip groove',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'identity-conflict' },
        });
        render(<GrooveDropTarget />);
        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        await screen.findByText('Previewing “Source clip groove”');
        fireEvent.click(screen.getByRole('button', { name: 'Save groove' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'A different groove template already uses this identity. Rename it or preview again.'
        );
    });

    it('shows typed empty and unsupported results without creating history', async () => {
        setMidiStoreState({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        const { rerender } = render(<GrooveDropTarget />);

        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        expect(await screen.findByText('This MIDI clip has no notes.')).toBeInTheDocument();

        rerender(<GrooveDropTarget subdivision="1/64" />);
        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });
        expect(await screen.findByText('Subdivision 1/64 is not supported.')).toBeInTheDocument();
        expect(undoStore.value?.past).toEqual([]);
    });

    it('shows quantized input as Straight without exposing a commit action', async () => {
        setMidiStoreState({
            notesByClipId: {
                'clip-source': [
                    { id: 'one', pitch: 60, startBeat: 0, duration: 0.25, velocity: 100 },
                    { id: 'two', pitch: 64, startBeat: 0.25, duration: 0.25, velocity: 100 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });
        render(<GrooveDropTarget />);

        fireEvent.drop(screen.getByLabelText('Extract groove from MIDI clip'), {
            dataTransfer: createDataTransfer('clip-source'),
        });

        expect(await screen.findByText('This MIDI clip is already Straight.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save groove' })).not.toBeInTheDocument();
        expect(grooveTemplateStore.value).toEqual(defaultGrooveTemplateState);
        expect(undoStore.value?.past).toEqual([]);
    });
});
