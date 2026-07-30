import { beforeEach, describe, expect, it } from 'vitest';

import { getTargetTrackRevision } from '../getTargetTrackRevision';
import { setTargetTrackId } from '../setTargetTrackId';
import { webMidiRuntime } from '../state';

describe('Web MIDI target track revision', () => {
    beforeEach(() => {
        webMidiRuntime.targetTrackId = null;
        webMidiRuntime.targetTrackRevision = 0;
    });

    it('increments for every route ownership event, including selecting the same track', () => {
        setTargetTrackId('t1');
        setTargetTrackId('t1');
        setTargetTrackId(null);

        expect(getTargetTrackRevision()).toBe(3);
        expect(webMidiRuntime.targetTrackId).toBeNull();
    });
});
