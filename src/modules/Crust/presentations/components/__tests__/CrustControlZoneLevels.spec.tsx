import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type CrustPatch, DEFAULT_CRUST_PATCH } from '../../../models/CrustPatch';
import { CrustControlZone } from '../CrustControlZone';

// Level 3+ content only mounts past the default uiLevel=2 fixture used by the
// sibling CrustControlZone.spec.tsx, so these specs target the deeper levels
// (style tiles, saturation, multi-band/dither, and the loudness stats panel)
// that the base spec never reaches.
function renderZone(
    patch: Partial<CrustPatch>,
    setParam = vi.fn<(key: keyof CrustPatch, value: unknown) => void>()
): { setParam: typeof setParam } & ReturnType<typeof render> {
    const rendered = render(
        <CrustControlZone
            patch={{ ...DEFAULT_CRUST_PATCH, ...patch }}
            setParam={setParam}
            lufsIntegrated={-14.2}
            lufsShortTerm={-13.6}
            lufsMomentary={-12.1}
            lra={4.5}
            truepeakMax={-0.8}
            grDb={-2.3}
        />
    );
    return { ...rendered, setParam };
}

describe('CrustControlZone level 1 (style tiles)', () => {
    it('marks the tile matching the current style as pressed and forwards clicks to setParam', () => {
        const { setParam } = renderZone({ uiLevel: 1, style: 'punchy' });

        expect(screen.getByRole('button', { name: /punchy/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /transparent/i })).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(screen.getByRole('button', { name: /^loud/i }));

        // Style→algorithm sync lives on setCrustParamWithAudio so L1 does not
        // schedule a second engine algorithm write.
        expect(setParam).toHaveBeenCalledTimes(1);
        expect(setParam).toHaveBeenCalledWith('style', 'loud');
        expect(setParam).not.toHaveBeenCalledWith('algorithm', expect.anything());
    });
});

describe('CrustControlZone level 2 (algorithm chips)', () => {
    it('marks Wall pressed when the patch style is loud and algorithm is wall', () => {
        renderZone({ uiLevel: 2, style: 'loud', algorithm: 'wall' });

        expect(screen.getByRole('button', { name: 'Wall' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Transparent' })).not.toHaveAttribute('aria-pressed');
    });

    it('prevents level 2 core controls from collapsing with shrink-0', () => {
        renderZone({ uiLevel: 2 });
        const algorithmLabel = screen.getByText('Algorithm');
        const coreContainer = algorithmLabel.closest('.shrink-0');
        expect(coreContainer).toBeInTheDocument();
    });
});

describe('CrustControlZone level 3 (saturation)', () => {
    it('disables the saturation algorithm chips while satEnabled is false', () => {
        renderZone({ uiLevel: 3, satEnabled: false });

        expect(screen.getByRole('button', { name: 'tape' })).toBeDisabled();
    });

    it('shows the HOT badge only once satEnabled and drive both cross their thresholds', () => {
        const cold = renderZone({ uiLevel: 3, satEnabled: true, satDrive: 6 });
        expect(cold.queryByText('HOT')).not.toBeInTheDocument();
        cold.unmount();

        const enabledHot = renderZone({ uiLevel: 3, satEnabled: true, satDrive: 6.1 });
        expect(enabledHot.getByText('HOT')).toBeInTheDocument();
        enabledHot.unmount();

        const disabledHot = renderZone({ uiLevel: 3, satEnabled: false, satDrive: 12 });
        expect(disabledHot.queryByText('HOT')).not.toBeInTheDocument();
    });

    it('prevents saturation section card from collapsing under flex-shrink', () => {
        renderZone({ uiLevel: 3 });
        const satTitle = screen.getByText('Saturation');
        const satCard = satTitle.closest('section');
        expect(satCard).toBeInTheDocument();
        expect(satCard).toHaveClass('shrink-0');
    });

    it('prevents level 3 extra controls from collapsing with shrink-0', () => {
        renderZone({ uiLevel: 3 });
        const deltaToggle = screen.getByRole('switch', { name: 'DELTA' });
        const extraRow = deltaToggle.closest('.shrink-0');
        expect(extraRow).toBeInTheDocument();
    });
});

describe('CrustControlZone level 4 (routing)', () => {
    it('forwards the multi-band selection to setParam', () => {
        const { setParam } = renderZone({ uiLevel: 4, multiBand: 'wideband' });

        fireEvent.click(screen.getByRole('button', { name: '3band' }));

        expect(setParam).toHaveBeenCalledWith('multiBand', '3band');
    });

    it('only renders the sidechain HPF knob once scHpfEnabled is on', () => {
        const off = renderZone({ uiLevel: 4, scHpfEnabled: false });
        expect(off.queryByText('HPF')).not.toBeInTheDocument();
        off.unmount();

        renderZone({ uiLevel: 4, scHpfEnabled: true });
        expect(screen.getByText('HPF')).toBeInTheDocument();
    });

    it('hides the output-bit-depth chips while dither is off', () => {
        renderZone({ uiLevel: 4, dither: 'off' });

        expect(screen.queryByRole('button', { name: '24-bit' })).not.toBeInTheDocument();
    });

    it('shows the output-bit-depth chips once dither is enabled and forwards clicks to setParam', () => {
        const { setParam } = renderZone({ uiLevel: 4, dither: 'tpdf24', outputBitDepth: 16 });

        fireEvent.click(screen.getByRole('button', { name: '24-bit' }));

        expect(setParam).toHaveBeenCalledWith('outputBitDepth', 24);
    });

    it('forwards the dither selection to setParam', () => {
        const { setParam } = renderZone({ uiLevel: 4, dither: 'off' });

        fireEvent.change(screen.getByRole('combobox', { name: /dither mode/i }), { target: { value: 'powr2' } });

        expect(setParam).toHaveBeenCalledWith('dither', 'powr2');
    });

    it('prevents level 4 extra controls from collapsing with shrink-0', () => {
        renderZone({ uiLevel: 4 });
        const multiBandLabel = screen.getByText('Multi-band');
        const extraContainer = multiBandLabel.closest('.shrink-0');
        expect(extraContainer).toBeInTheDocument();
    });
});

describe('CrustControlZone level 5 (loudness stats)', () => {
    it('renders each stat row formatted to one decimal with its unit suffix', () => {
        renderZone({ uiLevel: 5 });

        const stats = screen.getByRole('group', { name: /loudness statistics/i });
        expect(stats).toHaveTextContent('-14.2 LUFS');
        expect(stats).toHaveTextContent('-13.6 LUFS');
        expect(stats).toHaveTextContent('-12.1 LUFS');
        expect(stats).toHaveTextContent('4.5 LU');
        expect(stats).toHaveTextContent('-0.8 dBTP');
        expect(stats).toHaveTextContent('-2.3 dB');
    });

    it('prevents loudness statistics grid from collapsing with shrink-0', () => {
        renderZone({ uiLevel: 5 });
        const stats = screen.getByRole('group', { name: /loudness statistics/i });
        expect(stats).toHaveClass('shrink-0');
    });
});
