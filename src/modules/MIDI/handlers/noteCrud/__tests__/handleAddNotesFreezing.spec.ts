import { beforeEach, describe, expect, it } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setArrangementEventBus, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, undo } from '#/modules/Command/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { type MidiNote } from '../../../models/MidiNote';
import { midiStore } from '../../../stores/midiStore';
import { handleRestoreMidiClipNotes } from '../../noteTransform/handleRestoreMidiClipNotes';
import { handleAddNotes } from '../handleAddNotes';

const CLIP_ID = 'clip-1';
const TRACK_ID = 'track-1';
const EXISTING_NOTE: MidiNote = { id: 'existing', pitch: 48, startBeat: 0, duration: 1, velocity: 80 };

type NotificationEvents = {
    'ui.confirm': ConfirmPayload;
    'ui.notify': NotifyPayload;
    'ui.prompt': PromptPayload;
};

function currentNotes(): MidiNote[] {
    return midiStore.value?.notesByClipId[CLIP_ID] ?? [];
}

function setTrackFreezeStatus(status: 'unfrozen' | 'freezing' | 'frozen'): void {
    setTrackStoreState({
        ...defaultTrackState,
        tracks: trackStore.value!.tracks.map((track) => ({
            ...track,
            frozen: status === 'frozen',
            freezeState: { status },
        })),
    });
}

function addNotesAction(id: string) {
    return {
        type: 'addNotes' as const,
        payload: { clipId: CLIP_ID, notes: [{ id, pitch: 60, startBeat: 1, duration: 1, velocity: 100 }] },
    };
}

describe('MIDI note writes while the owning track freezes', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap({ addNotes: handleAddNotes, restoreMidiClipNotes: handleRestoreMidiClipNotes });
        clearUndoHistory();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus(createEventBus<NotificationEvents>());
        setTrackStoreState({
            ...defaultTrackState,
            tracks: [createTrack({ id: TRACK_ID, kind: 'midi', name: 'MIDI' })],
        });
        addClip({ id: CLIP_ID, trackId: TRACK_ID, startBeat: 0, endBeat: 4, name: 'MIDI clip', type: 'midi' });
        midiStore.set({ notesByClipId: { [CLIP_ID]: [EXISTING_NOTE] }, ccByClipId: {}, pitchBendByClipId: {} });
    });

    it('writes a note on an idle unfrozen track', async () => {
        setTrackFreezeStatus('unfrozen');

        await executeAppAction(addNotesAction('note-idle'));

        expect(currentNotes().map((note) => note.id)).toEqual(['existing', 'note-idle']);
    });

    it.each(['freezing', 'frozen'] as const)(
        'refuses an added note on a %s track and writes nothing',
        async (status) => {
            setTrackFreezeStatus(status);
            const action = addNotesAction('note-refused');

            expect(handleAddNotes.describe(action).inverseAction).toBeNull();
            expect(handleAddNotes.execute(action)).toEqual({ status: 'conflict' });
            await expect(executeAppAction(action)).rejects.toThrow(
                'Action conflicts with current project state: addNotes'
            );

            expect(currentNotes()).toEqual([EXISTING_NOTE]);
        }
    );

    it('refuses an undo that replays onto a track that began freezing after the edit', async () => {
        setTrackFreezeStatus('unfrozen');
        await executeAppAction(addNotesAction('note-added'));
        setTrackFreezeStatus('freezing');

        await undo();

        expect(currentNotes().map((note) => note.id)).toEqual(['existing', 'note-added']);
    });
});
