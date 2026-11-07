import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { commandProjectRevisionPort } from '../commandProjectRevisionPort';

describe('commandProjectRevisionPort.matchesLiveIgnoringSaveWrites', () => {
    afterEach(() => {
        commandProjectRevisionPort.setProvider(null);
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(null);
    });

    it('asks the registered matcher even for the exact live revision, which a write not yet in the heads may have changed', () => {
        commandProjectRevisionPort.setProvider(() => 'revision-live');
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(() => false);

        expect(commandProjectRevisionPort.matchesLiveIgnoringSaveWrites('revision-live')).toBe(false);
    });

    it('accepts the exact live revision while no matcher is registered', () => {
        commandProjectRevisionPort.setProvider(() => 'revision-live');

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

describe('commandProjectRevisionPort captured mutation authority', () => {
    let port: typeof commandProjectRevisionPort;
    beforeEach(async () => {
        vi.resetModules();
        port = (await import('../commandProjectRevisionPort')).commandProjectRevisionPort;
    });

    it('refuses an unconfigured revision source instead of trusting its sentinel', () => {
        expect(() => port.captureMutationAuthorization()).toThrow('requires a configured project revision provider');
    });

    it('supports only exact revision equality for a configured synthetic source', () => {
        let revision = 'base';
        port.setProvider(() => revision);
        const matches = vi.fn(() => {
            throw new Error('Historical matcher cannot run in a candidate');
        });
        port.setLiveMatchIgnoringSaveWrites(matches);
        const isAuthorized = port.captureMutationAuthorization();
        expect(isAuthorized()).toBe(true);
        revision = 'changed';
        expect(isAuthorized()).toBe(false);
        expect(matches).not.toHaveBeenCalled();
    });

    it('invalidates a captured guard when its provider is replaced and restored', () => {
        const source = () => 'base';
        port.setProvider(source);
        const isAuthorized = port.captureMutationAuthorization();
        port.setProvider(() => 'base');
        port.setProvider(source);
        expect(isAuthorized()).toBe(false);
    });

    it('does not borrow the configured provenance of a different revision provider', () => {
        const realSource = () => 'real';
        const capture = vi.fn(() => {
            throw new Error('Wrong source authority');
        });
        port.configureMutationAuthority({ revisionProvider: realSource, captureMutationAuthorization: capture });
        let synthetic = 'synthetic';
        port.setProvider(() => synthetic);
        const isAuthorized = port.captureMutationAuthorization();
        expect(isAuthorized()).toBe(true);
        synthetic = 'changed';
        expect(isAuthorized()).toBe(false);
        expect(capture).not.toHaveBeenCalled();
    });

    it('uses the associated authority and refuses a different registration', () => {
        const source = () => 'base';
        let authorized = true;
        const capture = () => () => authorized;
        const descriptor = { revisionProvider: source, captureMutationAuthorization: capture };
        port.configureMutationAuthority(descriptor);
        expect(() => port.configureMutationAuthority({ ...descriptor })).not.toThrow();
        port.setProvider(source);
        const isAuthorized = port.captureMutationAuthorization();
        expect(isAuthorized()).toBe(true);
        authorized = false;
        expect(isAuthorized()).toBe(false);
        expect(() => port.configureMutationAuthority({ ...descriptor, revisionProvider: () => 'other' })).toThrow(
            'differs'
        );
    });
});
