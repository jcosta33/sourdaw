import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AdjustmentLayerStrip, EMPTY_RANGE_SENTINEL, DEFAULT_FULL_RANGE_REGION } from '../AdjustmentLayerStrip';

type MockLayer = {
    id: string;
    name: string;
    effectType: 'eq' | 'volume' | 'pan';
    parameters: Array<{ name: string; value: number; min: number; max: number; unit: string }>;
    affectedTrackIds: string[];
    insertionIndex: number;
    regions: Array<{
        id: string;
        startBeat: number;
        endBeat: number;
        blend: number;
        fadeInBeats: number;
        fadeOutBeats: number;
    }>;
    enabled: boolean;
    mix: number;
    color: string;
};

const mocks = vi.hoisted(() => ({
    layers: [] as MockLayer[],
    tracks: [] as Array<{ id: string; name: string }>,
    executeAppAction: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: (_store: unknown, defaultValue: unknown) => {
        // The component subscribes to adjustmentLayerStore then trackStore.
        // Distinguish by the default value's shape: adjustment state carries a
        // `layers` key; track state carries a `tracks` key.
        const def = defaultValue as Record<string, unknown>;
        if ('layers' in def) {
            return { layers: mocks.layers };
        }
        return { tracks: mocks.tracks };
    },
}));

vi.mock('../../../stores/adjustmentLayer', () => ({
    adjustmentLayerStore: {},
    EFFECT_PRESETS: {
        eq: [{ name: 'Gain', value: 0, min: -12, max: 12, unit: 'dB' }],
        volume: [],
        pan: [],
    },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

vi.mock('../TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({
        children,
        role,
        'aria-label': ariaLabel,
        style,
    }: {
        children: React.ReactNode;
        role?: string;
        'aria-label'?: string;
        style?: React.CSSProperties;
    }) => (
        <div role={role} aria-label={ariaLabel} style={style} data-testid="timeline-chrome">
            {children}
        </div>
    ),
}));

describe('AdjustmentLayerStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.layers = [];
    });

    const renderStrip = () => render(<AdjustmentLayerStrip pixelsPerBeat={20} scrollX={0} />);

    it('should render without crashing', () => {
        const { container } = renderStrip();
        expect(container.firstChild).not.toBeNull();
    });

    it('should expose a region role with an accessible name', () => {
        renderStrip();
        const region = screen.getByRole('region', { name: /adjustment layers/i });
        expect(region).toBeInTheDocument();
    });

    it('should render a bar per layer', () => {
        mocks.layers = [
            {
                id: 'L1',
                name: 'EQ Layer',
                effectType: 'eq',
                parameters: [],
                affectedTrackIds: [],
                insertionIndex: 0,
                regions: [{ id: 'r1', startBeat: 0, endBeat: 4, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
                enabled: true,
                mix: 1,
                color: '#ff0000',
            },
            {
                id: 'L2',
                name: 'Compressor',
                effectType: 'volume',
                parameters: [],
                affectedTrackIds: [],
                insertionIndex: 1,
                regions: [{ id: 'r2', startBeat: 2, endBeat: 8, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
                enabled: true,
                mix: 1,
                color: '#00ff00',
            },
        ];
        renderStrip();
        expect(screen.getByText('EQ Layer')).toBeInTheDocument();
        expect(screen.getByText('Compressor')).toBeInTheDocument();
    });

    it('should dispatch addAdjustmentRegion on Alt+click of a lane', () => {
        mocks.layers = [
            {
                id: 'L1',
                name: 'EQ Layer',
                effectType: 'eq',
                parameters: [],
                affectedTrackIds: [],
                insertionIndex: 0,
                regions: [],
                enabled: true,
                mix: 1,
                color: '#ff0000',
            },
        ];
        renderStrip();
        const layerRow = screen.getByText('EQ Layer').closest('div[class*="absolute"]')!.parentElement!;
        fireEvent.click(layerRow, { altKey: true, button: 0, clientX: 200 });
        const calls = mocks.executeAppAction.mock.calls;
        const addRegionCall = calls.find((call) => {
            const action = call[0] as { type: string };
            return action.type === 'addAdjustmentRegion';
        });
        expect(addRegionCall).toBeDefined();
    });

    it('should open a context menu on right-click of a region', () => {
        mocks.layers = [
            {
                id: 'L1',
                name: 'EQ Layer',
                effectType: 'eq',
                parameters: [],
                affectedTrackIds: [],
                insertionIndex: 0,
                regions: [{ id: 'r1', startBeat: 2, endBeat: 8, blend: 1, fadeInBeats: 0, fadeOutBeats: 0 }],
                enabled: true,
                mix: 1,
                color: '#ff0000',
            },
        ];
        renderStrip();
        const layerRow = screen.getByText('EQ Layer').closest('div[class*="absolute"]')!.parentElement!;
        fireEvent.contextMenu(layerRow, { clientX: 100, clientY: 100 });
        expect(within(screen.getByRole('menu')).getByText(/disable layer|enable layer/i)).toBeInTheDocument();
    });

    it('should open the Add menu when the add button is clicked', () => {
        renderStrip();
        const addButton = screen.getByRole('button', { name: /add adjustment layer/i });
        fireEvent.click(addButton);
        expect(screen.getByText('New Adjustment Layer')).toBeInTheDocument();
    });

    const layerWithRegion = (): MockLayer => ({
        id: 'L1',
        name: 'EQ Layer',
        effectType: 'eq',
        parameters: [{ name: 'Gain', value: 0, min: -12, max: 12, unit: 'dB' }],
        affectedTrackIds: ['t1'],
        insertionIndex: 0,
        regions: [{ id: 'r1', startBeat: 2, endBeat: 8, blend: 1, fadeInBeats: 1, fadeOutBeats: 1 }],
        enabled: true,
        mix: 0.7,
        color: '#ff0000',
    });

    const findCall = (type: string): unknown => {
        const call = mocks.executeAppAction.mock.calls.find((c) => (c[0] as { type: string }).type === type);
        if (!call) {
            throw new Error(`expected executeAppAction call of type ${type}`);
        }
        return call[0];
    };

    it('creates an adjustment layer of the selected effect type from the add menu', () => {
        renderStrip();
        fireEvent.click(screen.getByRole('button', { name: /add adjustment layer/i }));
        fireEvent.click(screen.getByText('Eq'));
        expect(findCall('createAdjustmentLayer')).toMatchObject({
            type: 'createAdjustmentLayer',
            payload: { name: 'Eq Layer', effectType: 'eq' },
        });
    });

    it('toggles a layer enabled from the row power button', () => {
        mocks.layers = [layerWithRegion()];
        renderStrip();
        fireEvent.click(screen.getByRole('button', { name: 'Disable layer' }));
        expect(findCall('toggleAdjustmentLayer')).toMatchObject({
            type: 'toggleAdjustmentLayer',
            payload: { layerId: 'L1' },
        });
    });

    it('removes a layer from the row remove button', () => {
        mocks.layers = [layerWithRegion()];
        renderStrip();
        fireEvent.click(screen.getByRole('button', { name: 'Remove layer' }));
        expect(findCall('removeAdjustmentLayer')).toMatchObject({
            type: 'removeAdjustmentLayer',
            payload: { layerId: 'L1' },
        });
    });

    it('opens the affected-tracks picker from the row settings button', () => {
        mocks.layers = [layerWithRegion()];
        renderStrip();
        fireEvent.click(screen.getByRole('button', { name: 'Affected tracks' }));
        expect(screen.getByRole('dialog', { name: /affected tracks for eq layer/i })).toBeInTheDocument();
    });

    it('toggles track membership in the affected-tracks picker', () => {
        mocks.layers = [layerWithRegion()];
        mocks.tracks = [
            { id: 't1', name: 'Guitar' },
            { id: 't2', name: 'Bass' },
        ];
        renderStrip();
        fireEvent.click(screen.getByRole('button', { name: 'Affected tracks' }));
        // t1 is already selected; clicking it removes it.
        const guitarCheckbox = screen.getByLabelText('Guitar') as HTMLInputElement;
        fireEvent.click(guitarCheckbox);
        expect(findCall('setLayerAffectedTracks')).toMatchObject({
            type: 'setLayerAffectedTracks',
            payload: { layerId: 'L1', trackIds: [] },
        });
    });

    it('clears all affected tracks via the clear button', () => {
        mocks.layers = [layerWithRegion()];
        renderStrip();
        fireEvent.click(screen.getByRole('button', { name: 'Affected tracks' }));
        fireEvent.click(screen.getByText('Clear (= all below)'));
        expect(findCall('setLayerAffectedTracks')).toMatchObject({
            type: 'setLayerAffectedTracks',
            payload: { layerId: 'L1', trackIds: [] },
        });
    });

    const findRegionElement = (): HTMLElement => {
        // The region band hosts the fade-in/out sliders; walk up from one to the
        // region container that owns the double-click / context-menu handlers.
        const fadeSlider = screen.getByRole('slider', { name: 'Fade in' });
        return fadeSlider.closest('div.cursor-grab') as unknown as HTMLElement;
    };

    it('opens the parameter inspector on region double-click', () => {
        mocks.layers = [layerWithRegion()];
        renderStrip();
        fireEvent.doubleClick(findRegionElement());
        expect(screen.getByRole('dialog', { name: /adjustment layer: eq layer/i })).toBeInTheDocument();
    });

    it('removes a region from the region context menu', () => {
        mocks.layers = [layerWithRegion()];
        renderStrip();
        fireEvent.contextMenu(findRegionElement(), { clientX: 100, clientY: 100 });
        fireEvent.click(screen.getByText('Remove Region'));
        expect(findCall('removeAdjustmentRegion')).toMatchObject({
            type: 'removeAdjustmentRegion',
            payload: { layerId: 'L1', regionId: 'r1' },
        });
    });

    it('opens the inspector from the region context menu', () => {
        mocks.layers = [layerWithRegion()];
        renderStrip();
        fireEvent.contextMenu(findRegionElement(), { clientX: 100, clientY: 100 });
        fireEvent.click(screen.getByText('Edit Layer Parameters…'));
        expect(screen.getByRole('dialog', { name: /adjustment layer: eq layer/i })).toBeInTheDocument();
    });

    it('ignores a non-primary-button lane click for region creation', () => {
        mocks.layers = [layerWithRegion()];
        renderStrip();
        const regionEl = screen.getByText('EQ Layer').closest('div[class*="absolute"]')!.parentElement!;
        fireEvent.click(regionEl, { altKey: true, button: 2, clientX: 200 });
        expect(
            mocks.executeAppAction.mock.calls.some((c) => (c[0] as { type: string }).type === 'addAdjustmentRegion')
        ).toBe(false);
    });

    it('ignores a plain (non-alt) lane click for region creation', () => {
        mocks.layers = [layerWithRegion()];
        renderStrip();
        const regionEl = screen.getByText('EQ Layer').closest('div[class*="absolute"]')!.parentElement!;
        fireEvent.click(regionEl, { altKey: false, button: 0, clientX: 200 });
        expect(
            mocks.executeAppAction.mock.calls.some((c) => (c[0] as { type: string }).type === 'addAdjustmentRegion')
        ).toBe(false);
    });

    // Region/fade drags attach window-level mousemove/mouseup listeners. We
    // capture them so we can drive the drag and assert the committed command.
    const captureWindowListeners = () => {
        const moves: Array<(e: { clientX: number }) => void> = [];
        const ups: Array<() => void> = [];
        const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation(((
            type: string,
            listener: (...args: never[]) => void
        ) => {
            if (type === 'mousemove') {
                moves.push(listener as unknown as (e: { clientX: number }) => void);
            } else if (type === 'mouseup') {
                ups.push(listener);
            }
        }) as typeof window.addEventListener);
        return {
            move: (clientX: number) => {
                for (const m of moves) {
                    m({ clientX });
                }
            },
            up: () => {
                for (const u of ups) {
                    u();
                }
            },
            restore: () => addSpy.mockRestore(),
        };
    };

    it('commits a region move drag to moveAdjustmentRegion', () => {
        mocks.layers = [layerWithRegion()];
        const drag = captureWindowListeners();
        renderStrip();
        fireEvent.mouseDown(findRegionElement(), { button: 0, clientX: 100 });
        // pixelsPerBeat=20 → 40px = 2 beats; move shifts start 2->4, end 8->10.
        drag.move(140);
        drag.up();
        expect(findCall('moveAdjustmentRegion')).toMatchObject({
            type: 'moveAdjustmentRegion',
            payload: { regionId: 'r1', startBeat: 4, endBeat: 10 },
        });
    });

    it('commits a resizeStart drag from the left resize handle', () => {
        mocks.layers = [layerWithRegion()];
        const drag = captureWindowListeners();
        renderStrip();
        const handles = document.querySelectorAll('.cursor-ew-resize');
        fireEvent.mouseDown(handles[0]!, { button: 0, clientX: 100 });
        drag.move(140);
        drag.up();
        expect(findCall('moveAdjustmentRegion')).toMatchObject({
            type: 'moveAdjustmentRegion',
            payload: { regionId: 'r1', startBeat: 4, endBeat: 8 },
        });
    });

    it('commits a resizeEnd drag from the right resize handle', () => {
        mocks.layers = [layerWithRegion()];
        const drag = captureWindowListeners();
        renderStrip();
        const handles = document.querySelectorAll('.cursor-ew-resize');
        fireEvent.mouseDown(handles[1]!, { button: 0, clientX: 100 });
        drag.move(140);
        drag.up();
        expect(findCall('moveAdjustmentRegion')).toMatchObject({
            type: 'moveAdjustmentRegion',
            payload: { regionId: 'r1', startBeat: 2, endBeat: 10 },
        });
    });

    it('does not commit a region move below the minimum drag threshold', () => {
        mocks.layers = [layerWithRegion()];
        const drag = captureWindowListeners();
        renderStrip();
        fireEvent.mouseDown(findRegionElement(), { button: 0, clientX: 100 });
        drag.move(101); // < MIN_DRAG_PX (3)
        drag.up();
        expect(
            mocks.executeAppAction.mock.calls.some((c) => (c[0] as { type: string }).type === 'moveAdjustmentRegion')
        ).toBe(false);
    });

    it('commits a fadeIn drag to setLayerFades', () => {
        mocks.layers = [layerWithRegion()];
        const drag = captureWindowListeners();
        renderStrip();
        fireEvent.mouseDown(screen.getByRole('slider', { name: 'Fade in' }), { button: 0, clientX: 100 });
        // +40px at 20ppb = +2 beats: fadeIn 1->3 (capped at width-fadeOut=6-1=5).
        drag.move(140);
        drag.up();
        expect(findCall('setLayerFades')).toMatchObject({
            type: 'setLayerFades',
            payload: { regionId: 'r1', fadeInBeats: 3, fadeOutBeats: 1 },
        });
    });

    it('commits a fadeOut drag to setLayerFades', () => {
        mocks.layers = [layerWithRegion()];
        const drag = captureWindowListeners();
        renderStrip();
        fireEvent.mouseDown(screen.getByRole('slider', { name: 'Fade out' }), { button: 0, clientX: 100 });
        // +40px at 20ppb = +2 beats: fadeOut 1 - 2 = -1, clamped to 0.
        drag.move(140);
        drag.up();
        expect(findCall('setLayerFades')).toMatchObject({
            type: 'setLayerFades',
            payload: { regionId: 'r1', fadeInBeats: 1, fadeOutBeats: 0 },
        });
    });

    it('ignores a non-primary-button region drag start', () => {
        mocks.layers = [layerWithRegion()];
        const drag = captureWindowListeners();
        renderStrip();
        fireEvent.mouseDown(findRegionElement(), { button: 2, clientX: 100 });
        drag.move(200);
        drag.up();
        expect(
            mocks.executeAppAction.mock.calls.some((c) => (c[0] as { type: string }).type === 'moveAdjustmentRegion')
        ).toBe(false);
    });

    describe('full-range sentinel (finding #55)', () => {
        it('is frozen so a stray write cannot mutate the shared singleton', () => {
            expect(Object.isFrozen(EMPTY_RANGE_SENTINEL)).toBe(true);
            expect(Object.isFrozen(DEFAULT_FULL_RANGE_REGION)).toBe(true);

            // A write to a region's startBeat must not corrupt the shared object
            // used for every region-less layer. In strict mode this throws.
            expect(() => {
                (EMPTY_RANGE_SENTINEL as { startBeat: number }).startBeat = 999;
            }).toThrow(TypeError);
            expect(EMPTY_RANGE_SENTINEL.startBeat).toBe(0);
        });
    });
});
