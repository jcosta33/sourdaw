import { beforeEach, describe, expect, it } from 'vitest';

import { getTargetTrackOwnerId } from '../getTargetTrackOwnerId';
import { getTargetTrackRevision } from '../getTargetTrackRevision';
import { setTargetTrackId } from '../setTargetTrackId';
import { webMidiRuntime } from '../state';

describe('Web MIDI target track ownership', () => {
    beforeEach(() => {
        webMidiRuntime.targetTrackId = null;
        webMidiRuntime.targetTrackOwnerId = null;
        webMidiRuntime.targetTrackRevision = 0;
    });

    it('increments every selection and clears action ownership on a manual same-track reselection', () => {
        setTargetTrackId('t1', 'owner-forward');
        expect(getTargetTrackOwnerId()).toBe('owner-forward');

        setTargetTrackId('t1');
        setTargetTrackId(null);

        expect(getTargetTrackRevision()).toBe(3);
        expect(getTargetTrackOwnerId()).toBeNull();
        expect(webMidiRuntime.targetTrackId).toBeNull();
    });
});
