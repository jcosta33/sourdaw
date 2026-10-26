import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const desktopInvokeMock = vi.hoisted(() => vi.fn());
const desktopListenMock = vi.hoisted(() => vi.fn());

function deferred<T>(): {
    promise: Promise<T>;
    reject: (reason: unknown) => void;
    resolve: (value: T) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function browserAccess(inputId: string): {
    inputs: Map<string, EventTarget & { id: string; manufacturer: string; name: string }>;
    onstatechange: null;
} {
    const input = Object.assign(new EventTarget(), {
        id: inputId,
        manufacturer: 'Test',
        name: inputId,
    });
    vi.spyOn(input, 'addEventListener');
    return { inputs: new Map([[inputId, input]]), onstatechange: null };
}

vi.mock('#/utils/desktopBridge', () => ({
    desktopInvoke: desktopInvokeMock,
    desktopListen: desktopListenMock,
    isDesktopRuntime: () => typeof window !== 'undefined' && 'sourdaw' in window,
}));

const originalSourdaw = Object.getOwnPropertyDescriptor(window, 'sourdaw');

function setDesktopMarker(present: boolean): void {
    if (present) {
        Object.defineProperty(window, 'sourdaw', { configurable: true, value: {} });
    } else {
        Reflect.deleteProperty(window, 'sourdaw');
    }
}

describe('Web MIDI capability snapshot at repository startup', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal('navigator', {});
        setDesktopMarker(false);
        desktopInvokeMock.mockResolvedValue([]);
        desktopListenMock.mockResolvedValue(() => {});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        if (originalSourdaw) {
            Object.defineProperty(window, 'sourdaw', originalSourdaw);
        } else {
            setDesktopMarker(false);
        }
    });

    it('uses the captured native route even when Web MIDI appears after startup', async () => {
        setDesktopMarker(true);
        const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');
        expect(getPlatformCapabilities().webMidiApiPresent).toBe(false);

        const { webMidiState } = await import('../../state');
        expect(webMidiState.current.isSupported).toBe(true);

        const requestMIDIAccess = vi.fn().mockRejectedValue(new Error('late browser route'));
        vi.stubGlobal('navigator', { requestMIDIAccess });
        const { initWebMidi } = await import('../initWebMidi');

        expect(await initWebMidi({ onMidiMessage: vi.fn() })).toBe(true);
        expect(requestMIDIAccess).not.toHaveBeenCalled();
        expect(desktopInvokeMock).toHaveBeenCalledWith('list_midi_inputs');
    });

    it('projects missing browser support to the public MIDI store without opening a device', async () => {
        const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');
        const capabilities = getPlatformCapabilities();
        expect(capabilities.hasMidiInput).toBe(false);
        expect(capabilities.degradations).toEqual([
            expect.objectContaining({ feature: 'midi-input', reason: 'api-absent' }),
        ]);

        const { initWebMidi } = await import('../initWebMidi');
        const { webMidiStore } = await import('../../../../stores/webMidiStore');
        expect(webMidiStore.value?.isSupported).toBe(false);
        expect(await initWebMidi({ onMidiMessage: vi.fn() })).toBe(false);
        expect(desktopInvokeMock).not.toHaveBeenCalled();
    });

    it('keeps browser permission refusal distinct from an absent Web MIDI API', async () => {
        const requestMIDIAccess = vi.fn().mockRejectedValue(new Error('Permission denied'));
        vi.stubGlobal('navigator', { requestMIDIAccess });
        const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');
        expect(getPlatformCapabilities().webMidiApiPresent).toBe(true);
        expect(getPlatformCapabilities().degradations).toEqual([]);

        const { initWebMidi } = await import('../initWebMidi');
        const { webMidiStore } = await import('../../../../stores/webMidiStore');
        expect(webMidiStore.value?.isSupported).toBe(true);
        expect(await initWebMidi({ onMidiMessage: vi.fn() })).toBe(false);
        expect(requestMIDIAccess).toHaveBeenCalledOnce();
        expect(webMidiStore.value).toEqual(
            expect.objectContaining({ isSupported: false, enumerationError: 'Permission denied' })
        );
    });

    it('retains a native enumeration failure without claiming the desktop route is missing', async () => {
        setDesktopMarker(true);
        desktopInvokeMock.mockRejectedValue(new Error('Native list failed'));
        const { getPlatformCapabilities } = await import('#/utils/platformCapabilities');
        expect(getPlatformCapabilities().hasMidiInput).toBe(true);
        expect(getPlatformCapabilities().degradations).toEqual([]);

        const { initWebMidi } = await import('../initWebMidi');
        const { webMidiStore } = await import('../../../../stores/webMidiStore');
        expect(await initWebMidi({ onMidiMessage: vi.fn() })).toBe(false);
        expect(webMidiStore.value).toEqual(
            expect.objectContaining({ isSupported: true, enumerationError: 'Native list failed' })
        );
    });

    it.each([
        { desktop: false, route: 'browser' },
        { desktop: true, route: 'desktop' },
    ])('keeps the successful $route init when an older permission request rejects', async ({ desktop }) => {
        setDesktopMarker(desktop);
        const olderPermission = deferred<never>();
        const requestMIDIAccess = vi
            .fn()
            .mockReturnValueOnce(olderPermission.promise)
            .mockResolvedValueOnce(browserAccess('keyboard-b'));
        vi.stubGlobal('navigator', { requestMIDIAccess });

        const { initWebMidi } = await import('../initWebMidi');
        const { webMidiStore } = await import('../../../../stores/webMidiStore');
        const { webMidiRuntime } = await import('../../state');
        const olderInit = initWebMidi({ onMidiMessage: vi.fn() });
        const onMidiMessage = vi.fn();
        expect(await initWebMidi({ onMidiMessage })).toBe(true);

        const activeInput = webMidiRuntime.activeInput;
        const activeListener = webMidiRuntime.midiMessageListener;
        expect(activeInput?.id).toBe('keyboard-b');
        expect(activeListener).not.toBeNull();
        expect(activeInput?.addEventListener).toHaveBeenCalledWith('midimessage', activeListener);
        expect(webMidiRuntime.nativeMode).toBe(false);

        olderPermission.reject(new Error('old permission request rejected'));
        expect(await olderInit).toBe(false);

        expect(webMidiStore.value).toEqual(
            expect.objectContaining({ isSupported: true, selectedInputId: 'keyboard-b', enumerationError: null })
        );
        expect(webMidiRuntime.activeInput).toBe(activeInput);
        expect(webMidiRuntime.midiMessageListener).toBe(activeListener);
        expect(activeInput?.addEventListener).toHaveBeenCalledWith('midimessage', activeListener);
        expect(webMidiRuntime.nativeMode).toBe(false);
        activeInput?.dispatchEvent(new Event('midimessage'));
        expect(onMidiMessage).toHaveBeenCalledOnce();
        if (desktop) {
            expect(desktopInvokeMock).not.toHaveBeenCalled();
        }
    });
});
