import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TransformPad } from '../TransformPad';

const applyMorphedPatchMock = vi.hoisted(() => vi.fn());
const bilinearPatchMock = vi.hoisted(() => vi.fn());

vi.mock('../../../useCases/presetMorph/applyMorphedPatch', () => ({
    applyMorphedPatch: applyMorphedPatchMock,
}));

vi.mock('../../../useCases/presetMorph/bilinearPatch', () => ({
    bilinearPatch: bilinearPatchMock,
}));

vi.mock('../../../useCases/fermenterQueries/helpers', () => ({
    FERMENTER_PRESETS: [
        {
            id: 'fermenter-init',
            name: 'Fermenter — Init',
            devices: [{ parameterValues: { oscLevel: 0.5, macro0: 0.1 } }],
        },
        {
            id: 'fermenter-supersaw',
            name: 'Fermenter — Supersaw',
            devices: [{ parameterValues: { oscCoarse: 12, macro7: 0.9 } }],
        },
        {
            id: 'fermenter-dark-drone',
            name: 'Fermenter — Dark Drone',
            devices: [{ parameterValues: { oscEngine: 2 } }],
        },
        {
            id: 'fermenter-acid-bass',
            name: 'Fermenter — Acid Bass',
            devices: [{ parameterValues: { macro3: 0.5, unknownKey: 'ignored' } }],
        },
    ],
}));

describe('TransformPad', () => {
    const mockDeviceId = 'device-123';

    beforeEach(() => {
        vi.clearAllMocks();
        bilinearPatchMock.mockReturnValue({ name: 'Morphed', cutoff: 800 });
    });

    it('renders the scene-morph header and a 160x160 canvas', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        expect(screen.getByText(/Scene morph/i)).toBeInTheDocument();
        expect(screen.getByText(/Four corners/i)).toBeInTheDocument();
        const canvas = document.querySelector('canvas')!;
        expect(canvas.style.width).toBe('160px');
        expect(canvas.style.height).toBe('160px');
    });

    it('parses corner presets from their parameterValues: numeric patch keys and macro keys', () => {
        // presetToPatch is module-private, but bilinearPatch receives the four
        // parsed corner patches. Inspecting its call args verifies the parse.
        render(<TransformPad deviceId={mockDeviceId} />);
        const canvas = document.querySelector('canvas')!;

        // A pointer-down triggers applyPosition → bilinearPatch with the corners.
        fireEvent.pointerDown(canvas, { clientX: 80, clientY: 80, pointerId: 1 });

        expect(bilinearPatchMock).toHaveBeenCalledTimes(1);
        const calls = bilinearPatchMock.mock.calls[0] as unknown as Array<
            Record<string, unknown> & { macros: number[] }
        >;
        const c0 = calls[0]!;
        const c1 = calls[1]!;
        const c2 = calls[2]!;
        const c3 = calls[3]!;
        // Init: oscLevel applied, macro0 applied
        expect(c0.oscLevel).toBe(0.5);
        expect(c0.macros[0]).toBe(0.1);
        expect(c0.name).toBe('Fermenter — Init');
        // Supersaw: oscCoarse + macro7
        expect(c1.oscCoarse).toBe(12);
        expect(c1.macros[7]).toBe(0.9);
        // Dark Drone: oscEngine
        expect(c2.oscEngine).toBe(2);
        // Acid Bass: macro3 applied, unknownKey ignored
        expect(c3.macros[3]).toBe(0.5);
        expect(c3.unknownKey).toBeUndefined();
    });

    it('morphs the patch and applies it to the device on pointer down', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        const canvas = document.querySelector('canvas')!;

        fireEvent.pointerDown(canvas, { clientX: 120, clientY: 40, pointerId: 1 });

        // bilinearPatch receives (corners..., x, y) where x/y are clamped 0..1
        const call = bilinearPatchMock.mock.calls[0]!;
        expect(call[4]).toBeGreaterThan(0);
        expect(call[5]).toBeGreaterThanOrEqual(0);
        // applyMorphedPatch receives (deviceId, morphedPatch); applyPosition
        // overrides the morphed name to 'Transform'.
        expect(applyMorphedPatchMock).toHaveBeenCalledWith(
            mockDeviceId,
            expect.objectContaining({ name: 'Transform' })
        );
    });

    it('continues morphing while dragging (pointerMove) and stops on pointerUp', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        const canvas = document.querySelector('canvas')!;

        fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
        const callsAfterDown = applyMorphedPatchMock.mock.calls.length;

        // Move while dragging → more morphs
        fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 100, clientY: 100, pointerId: 1 });
        expect(applyMorphedPatchMock.mock.calls.length).toBeGreaterThan(callsAfterDown);

        // Release → cursor returns to grab
        fireEvent.pointerUp(canvas);
        expect(canvas.style.cursor).toBe('grab');

        // Move after release → no new morphs
        const callsAfterUp = applyMorphedPatchMock.mock.calls.length;
        fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
        expect(applyMorphedPatchMock.mock.calls.length).toBe(callsAfterUp);
    });

    it('clears the dragging cursor on pointerCancel', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        const canvas = document.querySelector('canvas')!;

        fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
        expect(canvas.style.cursor).toBe('grabbing');

        fireEvent.pointerCancel(canvas);
        expect(canvas.style.cursor).toBe('grab');
    });

    it('clamps pointer coordinates to the 0..1 range', () => {
        render(<TransformPad deviceId={mockDeviceId} />);
        const canvas = document.querySelector('canvas')!;

        // Pointer far outside the canvas (negative / over-size) clamps to 0 / 1.
        fireEvent.pointerDown(canvas, { clientX: -500, clientY: 9999, pointerId: 1 });
        const call = bilinearPatchMock.mock.calls[bilinearPatchMock.mock.calls.length - 1]!;
        expect(call[4]).toBe(0); // x clamped to 0
        expect(call[5]).toBe(1); // y clamped to 1
    });
});
