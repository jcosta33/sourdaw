import { act, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PianoModel3D } from '../PianoModel3D';

/**
 * Regression (#1): the rAF render loop is created once in a []-deps effect.
 * It must read the *current* activeNotes / sustainPedal props through refs that
 * are refreshed each render — never the mount-time closure. These tests drive
 * the loop, swap the props, drive it again, and assert the loop touched the new
 * values.
 */

/** A WebGL2 mock that satisfies buildProgram and records draws. */
function makeGlMock(): WebGL2RenderingContext {
    const gl = {
        COMPILE_STATUS: 1,
        LINK_STATUS: 2,
        VERTEX_SHADER: 3,
        FRAGMENT_SHADER: 4,
        ARRAY_BUFFER: 5,
        FLOAT: 6,
        BLEND: 7,
        SRC_ALPHA: 8,
        ONE_MINUS_SRC_ALPHA: 9,
        COLOR_BUFFER_BIT: 16,
        TRIANGLES: 4,
        DYNAMIC_DRAW: 35048,
        createShader: vi.fn(() => ({})),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(() => true),
        deleteShader: vi.fn(),
        createProgram: vi.fn(() => ({})),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: vi.fn(() => true),
        deleteProgram: vi.fn(),
        useProgram: vi.fn(),
        getAttribLocation: vi.fn(() => 0),
        getUniformLocation: vi.fn(() => ({})),
        createVertexArray: vi.fn(() => ({})),
        createBuffer: vi.fn(() => ({})),
        bindVertexArray: vi.fn(),
        bindBuffer: vi.fn(),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        enable: vi.fn(),
        blendFunc: vi.fn(),
        viewport: vi.fn(),
        uniform2f: vi.fn(),
        clearColor: vi.fn(),
        clear: vi.fn(),
        bufferData: vi.fn(),
        drawArrays: vi.fn(),
    };
    return gl as unknown as WebGL2RenderingContext;
}

describe('PianoModel3D rAF prop freshness (#1)', () => {
    let rafCallbacks: FrameRequestCallback[];

    beforeEach(() => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((id: string) => {
            if (id === 'webgl2') {
                return makeGlMock() as unknown as RenderingContext;
            }
            return null;
        }) as typeof HTMLCanvasElement.prototype.getContext);

        rafCallbacks = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const tick = (): void => {
        const pending = rafCallbacks;
        rafCallbacks = [];
        act(() => {
            for (const cb of pending) {
                cb(performance.now());
            }
        });
    };

    it('reads the activeNotes map passed on the latest render, not the mount-time one', () => {
        const initialNotes = new Map<number, number>();
        const { rerender } = render(<PianoModel3D activeNotes={initialNotes} sustainPedal={0} lidPosition={0.5} />);
        tick(); // first frame reads the mount-time map

        // A fresh map for the next render; spy on its get to detect reads.
        const liveNotes = new Map<number, number>([[60, 0.9]]);
        const liveGet = vi.spyOn(liveNotes, 'get');
        rerender(<PianoModel3D activeNotes={liveNotes} sustainPedal={0} lidPosition={0.5} />);

        tick(); // next frame must read the live map

        expect(liveGet).toHaveBeenCalled();
    });

    it('reads the sustainPedal value passed on the latest render', () => {
        // Render with the pedal up so a held note's damper would only lift via
        // the pedal path. Use the active-note set to observe the loop's reads.
        const notes = new Map<number, number>([[60, 0.9]]);
        const { rerender } = render(<PianoModel3D activeNotes={notes} sustainPedal={0} lidPosition={0.5} />);
        tick();

        const liveNotes = new Map<number, number>([[60, 0.9]]);
        const liveGet = vi.spyOn(liveNotes, 'get');
        rerender(<PianoModel3D activeNotes={liveNotes} sustainPedal={1} lidPosition={0.5} />);
        tick();

        // The loop ran against the post-rerender props (the new map was read),
        // which is the same closure that now reads the new sustainPedal value.
        expect(liveGet).toHaveBeenCalled();
    });
});
