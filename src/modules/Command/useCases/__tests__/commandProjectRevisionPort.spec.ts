import { afterEach, describe, expect, it } from 'vitest';

import { commandProjectRevisionPort } from '../commandProjectRevisionPort';

describe('commandProjectRevisionPort.matchesLiveIgnoringSaveWrites', () => {
    afterEach(() => {
        commandProjectRevisionPort.setProvider(null);
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(null);
    });

    it('accepts the exact live revision without asking the registered matcher', () => {
        commandProjectRevisionPort.setProvider(() => 'revision-live');
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(() => false);

        expect(commandProjectRevisionPort.matchesLiveIgnoringSaveWrites('revision-live')).toBe(true);
    });

    it('defers a different revision to the registered matcher, which answers for content', () => {
        commandProjectRevisionPort.setProvider(() => 'revision-live');
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites((revision) => revision === 'revision-before-save');

        expect(commandProjectRevisionPort.matchesLiveIgnoringSaveWrites('revision-before-save')).toBe(true);
        expect(commandProjectRevisionPort.matchesLiveIgnoringSaveWrites('revision-before-edit')).toBe(false);
    });

    it('refuses a different revision while no matcher is registered', () => {
        commandProjectRevisionPort.setProvider(() => 'revision-live');

        expect(commandProjectRevisionPort.matchesLiveIgnoringSaveWrites('revision-before-save')).toBe(false);
    });
});
