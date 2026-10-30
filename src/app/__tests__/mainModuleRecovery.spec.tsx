import { isValidElement } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    App: () => null,
    bootstrap: vi.fn(),
    createRoot: vi.fn(),
    loadApp: vi.fn<() => Promise<void>>(),
    registerNotificationEventBus: vi.fn(),
    reloadApplication: vi.fn(),
    render: vi.fn(),
}));

vi.mock('../browserDisplayScaleHost', () => ({
    mountBrowserDisplayScaleHost: vi.fn(),
    resetBrowserDisplayScaleForChildStartup: vi.fn(),
}));
vi.mock('../resolveAppComposition', () => ({ resolveAppComposition: () => 'application' }));
vi.mock('../registerNotificationEventBus', () => ({
    registerNotificationEventBus: mocks.registerNotificationEventBus,
}));
vi.mock('../reloadApplication', () => ({ reloadApplication: mocks.reloadApplication }));
vi.mock('#/styles/main.css', () => ({}));
vi.mock('react-dom/client', () => ({ createRoot: mocks.createRoot }));

function expectSingleStartup(): void {
    expect(mocks.bootstrap).toHaveBeenCalledOnce();
    expect(mocks.createRoot).toHaveBeenCalledOnce();
    expect(mocks.registerNotificationEventBus).toHaveBeenCalledOnce();
}

describe('initial App module recovery', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.loadApp.mockReset();
        mocks.loadApp.mockResolvedValue(undefined);
        mocks.createRoot.mockReturnValue({ render: mocks.render });
        vi.doMock('../bootstrap', () => {
            mocks.bootstrap();
            return {};
        });
        vi.doMock('../App', async () => {
            await mocks.loadApp();
            return { App: mocks.App };
        });
        Reflect.deleteProperty(window, 'sourdaw');
        document.body.innerHTML = '<div id="root"></div>';
    });

    it('retries only the failed App import within the original startup', async () => {
        mocks.loadApp.mockRejectedValueOnce(new TypeError('failed module fetch'));
        await import('../main');
        await vi.waitFor(() => {
            expect(mocks.render.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ type: mocks.App }));
        });
        expect(mocks.loadApp).toHaveBeenCalledTimes(2);
        expect(mocks.render).toHaveBeenCalledTimes(2);
        expectSingleStartup();
        expect(mocks.reloadApplication).not.toHaveBeenCalled();
    });

    it('offers preloaded manual recovery for a sticky failed import without restarting startup', async () => {
        mocks.loadApp.mockRejectedValue(new TypeError('unavailable module graph'));
        await import('../main');
        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
        const terminal = mocks.render.mock.calls.at(-1)?.[0];
        expect(isValidElement(terminal)).toBe(true);
        if (!isValidElement(terminal)) {
            throw new Error('Missing terminal startup view');
        }
        render(terminal);
        expect(screen.getByRole('alert')).toHaveAccessibleName('Sourdaw could not start');
        expect(screen.getByText('The application did not finish loading. Reload Sourdaw to try again.')).toBeVisible();
        expect(mocks.loadApp).toHaveBeenCalledTimes(2);
        expectSingleStartup();
        expect(mocks.reloadApplication).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Reload Sourdaw' }));
        expect(mocks.reloadApplication).toHaveBeenCalledExactlyOnceWith(window.location);
    });

    it('never retries a successful App import', async () => {
        await import('../main');
        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
        expect(mocks.loadApp).toHaveBeenCalledOnce();
        expectSingleStartup();
    });
});
