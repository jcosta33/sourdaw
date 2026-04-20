import { describe, it, expect, beforeEach } from 'vitest';

import { Container } from '../Container';

describe('Container', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('register() throws on duplicate registration', () => {
        Container.register('test', 123);
        expect(() => Container.register('test', 456)).toThrow(/Token already registered/);
    });

    it('set() overwrites existing registrations silently', () => {
        Container.register('test', 123);
        Container.set('test', 456);
        expect(Container.get('test')).toBe(456);
    });

    it('register() and get() resolve registered values', () => {
        Container.register('my-token', 'hello');
        expect(Container.get('my-token')).toBe('hello');
    });

    it('get() throws if token not registered', () => {
        expect(() => Container.get('missing')).toThrow(/Token not registered/);
    });

    it('clear() clears container state', () => {
        Container.register('test', 123);
        Container.clear();
        expect(() => Container.get('test')).toThrow(/Token not registered/);
    });
});
