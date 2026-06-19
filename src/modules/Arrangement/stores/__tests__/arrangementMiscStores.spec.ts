import { describe, it, expect, beforeEach } from 'vitest';

import { clipboardStore, setClipClipboard, setNoteClipboard } from '../clipboardStore';
import { getEnvelope, removeEnvelope, setEnvelope, __resetGainEnvelopesForTest } from '../gainEnvelopeStore';
import { markerStore } from '../markerStore';
import { takeLaneStore } from '../takeLaneStore';
import { getVcaGroupsState, setVcaGroupsState } from '../vcaGroupStore';

import type { MidiNote } from '#/modules/MIDI/models/MidiNote';
import type { TakeLane } from '../../models/TakeLane';
import type { Clip } from '../../models/Track';

describe('Arrangement Misc Stores', () => {
    describe('clipboardStore', () => {
        beforeEach(() => {
            clipboardStore.set({ clipClipboard: [], noteClipboard: null });
        });

        it('should manage clip clipboard', () => {
            const entry = { clip: { id: 'c1' } as unknown as Clip, sourceTrackId: 't1' };
            setClipClipboard([entry]);
            expect(clipboardStore.value?.clipClipboard).toHaveLength(1);
            expect(clipboardStore.value?.clipClipboard[0]).toEqual(entry);
        });

        it('should manage note clipboard', () => {
            const entry = { notes: [{ id: 'n1' } as unknown as MidiNote] };
            setNoteClipboard(entry);
            expect(clipboardStore.value?.noteClipboard).toEqual(entry);

            setNoteClipboard(null);
            expect(clipboardStore.value?.noteClipboard).toBeNull();
        });
    });

    describe('gainEnvelopeStore', () => {
        beforeEach(() => {
            __resetGainEnvelopesForTest();
        });

        it('should store and retrieve envelopes by clip id', () => {
            const env = { clipId: 'c1', points: [], enabled: true };
            setEnvelope('c1', env);
            expect(getEnvelope('c1')).toEqual(env);
        });

        it('removeEnvelope drops the envelope for a clip and leaves others intact', () => {
            setEnvelope('c1', { clipId: 'c1', points: [], enabled: true });
            setEnvelope('c2', { clipId: 'c2', points: [], enabled: false });

            removeEnvelope('c1');

            expect(getEnvelope('c1')).toBeUndefined();
            expect(getEnvelope('c2')).toEqual({ clipId: 'c2', points: [], enabled: false });
        });

        it('removeEnvelope is a no-op for an unknown clip id', () => {
            setEnvelope('c2', { clipId: 'c2', points: [], enabled: false });
            removeEnvelope('nope');
            expect(getEnvelope('c2')).toEqual({ clipId: 'c2', points: [], enabled: false });
        });

        it('__resetGainEnvelopesForTest clears the store under test mode', () => {
            // Vitest sets import.meta.env.MODE to 'test', so the guard permits
            // the reset here; in a production build it is a no-op.
            setEnvelope('c1', { clipId: 'c1', points: [], enabled: true });
            __resetGainEnvelopesForTest();
            expect(getEnvelope('c1')).toBeUndefined();
        });
    });

    describe('markerStore', () => {
        beforeEach(() => {
            markerStore.set({ markers: [], sections: [] });
        });

        it('should store markers and sections', () => {
            const marker = { id: 'm1', beat: 4, name: 'Intro', color: '#fff' };
            markerStore.set({ markers: [marker], sections: [] });
            expect(markerStore.value?.markers).toHaveLength(1);
            expect(markerStore.value?.markers[0]).toEqual(marker);
        });
    });

    describe('takeLaneStore', () => {
        beforeEach(() => {
            takeLaneStore.set({ lanes: [] });
        });

        it('should store take lanes', () => {
            const lane = { id: 'l1', trackId: 't1', takes: [] };
            takeLaneStore.set({ lanes: [lane as unknown as TakeLane] });
            expect(takeLaneStore.value?.lanes).toHaveLength(1);
        });
    });

    describe('vcaGroupStore', () => {
        beforeEach(() => {
            setVcaGroupsState([]);
        });

        it('should manage vca groups array', () => {
            const group = { id: 'v1', name: 'Drums', gain: 1, muted: false, trackIds: [] };
            setVcaGroupsState([group]);
            expect(getVcaGroupsState()).toHaveLength(1);
            expect(getVcaGroupsState()[0]).toEqual(group);
        });
    });
});
