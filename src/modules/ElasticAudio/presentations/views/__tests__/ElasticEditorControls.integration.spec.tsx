import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clipSelectionStore, defaultClipSelectionState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { createCrdtDoc, registerCrdtStorageRuntime, removeCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { defaultElasticAudioState, elasticAudioStore } from '../../../stores/elasticAudio';
import { openElasticEditor } from '../../../useCases/elasticAudio/openElasticEditor';
import { ElasticEditorPanel } from '../ElasticEditorPanel';

describe('Elastic editor tools', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        const track = createTrack({ id: 'audio-track', name: 'Audio', kind: 'audio', withoutDefaultDevice: true });
        trackStore.set({
            tracks: [
                {
                    ...track,
                    clips: [
                        {
                            id: 'clip',
                            trackId: track.id,
                            name: 'Loop',
                            startBeat: 0,
                            endBeat: 2,
                            type: 'audio',
                            audioBufferId: 'buffer',
                            fadeInBeats: 0,
                            fadeOutBeats: 0,
                            gain: 1,
                            color: '#336699',
                            locked: false,
                            muted: false,
                        },
                    ],
                },
            ],
            selectedTrackId: track.id,
        });
        clipSelectionStore.set({ ...defaultClipSelectionState, selectedClipId: 'clip' });
        elasticAudioStore.set(defaultElasticAudioState);
        openElasticEditor('clip');
        flushAutomergeStorageWrites();
    });
    afterEach(() => {
        cleanup();
        elasticAudioStore.set(defaultElasticAudioState);
        clipSelectionStore.set(defaultClipSelectionState);
        trackStore.set({ tracks: [], selectedTrackId: null });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });
    // Covers the editor tool transitions formerly in elasticEditorTestId.
    it('selects Add and Remove through the real editor state', () => {
        render(<ElasticEditorPanel />);
        expect(screen.getByTestId('elastic-editor-panel')).toBeInTheDocument();
        const select = screen.getByRole('button', { name: 'Select', exact: true });
        const add = screen.getByRole('button', { name: 'Add', exact: true });
        const remove = screen.getByRole('button', { name: 'Remove', exact: true });
        expect(select).toHaveAttribute('aria-pressed', 'true');
        expect(add).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(add);
        expect(select).toHaveAttribute('aria-pressed', 'false');
        expect(add).toHaveAttribute('aria-pressed', 'true');
        expect(remove).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(remove);
        expect(add).toHaveAttribute('aria-pressed', 'false');
        expect(remove).toHaveAttribute('aria-pressed', 'true');
    });
});
