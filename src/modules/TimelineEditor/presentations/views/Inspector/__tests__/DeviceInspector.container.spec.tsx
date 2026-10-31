import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DeviceInspector } from '../DeviceInspector';

import type { Device } from '../../../../models/TrackViewTypes';

vi.mock('../layouts/BuiltinSynthLayout', () => ({}));
vi.mock('../layouts/FaustInstrumentLayout', () => ({}));
vi.mock('../layouts/HammondB3Layout', () => ({}));
vi.mock('../layouts/LufsMeterLayout', () => ({}));
vi.mock('../layouts/BuiltinLufsMeterLayout', () => ({}));

vi.mock('#/components/daw/visualizers/EQCurve', () => ({
    EQCurve: () => <div data-testid="eq-curve" />,
}));
vi.mock('../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string } }) => <div>{param.id}</div>,
}));
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    bypassDevice: vi.fn(),
}));

const CONTAINER_QUERY_VARIANT = /(^|\s)@[a-z0-9]+:/;

const makeDevice = (overrides: Partial<Device>): Device => ({
    id: 'device-1',
    name: 'Device',
    type: 'unregistered-effect',
    bypassed: false,
    parameterValues: { gain: 0.5, mix: 0.5 },
    ...overrides,
});

// jsdom has no layout, so the cascade cannot be observed. What can be pinned is the structure
// that makes the cascade work: a container-query variant resolves against the nearest
// `@container` ancestor, and with none the variant silently never applies.
const containerQueryUsers = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>('*')).filter((element) =>
        CONTAINER_QUERY_VARIANT.test(element.getAttribute('class') ?? '')
    );

describe('DeviceInspector container queries', () => {
    it.each([
        ['the generic layout', makeDevice({})],
        ['the EQ layout', makeDevice({ type: 'builtin-eq', name: 'EQ', parameterValues: {} })],
    ])('gives every container-query variant in %s an @container ancestor inside the inspector', (_name, device) => {
        const { container } = render(<DeviceInspector device={device} trackId="track-1" onBack={vi.fn()} />);
        const inspectorRoot = container.firstElementChild as HTMLElement;

        const users = containerQueryUsers(inspectorRoot);
        expect(users.length).toBeGreaterThan(0);
        for (const user of users) {
            const queryContainer = user.parentElement?.closest('.\\@container') ?? null;
            expect(queryContainer, `no @container above <${user.tagName} class="${user.className}">`).not.toBeNull();
            expect(inspectorRoot.contains(queryContainer)).toBe(true);
        }
    });
});
