/**
 * Shared meter colour helpers for the Crust metering components.
 *
 * `grColor` maps a gain-reduction amount (dB) to the Crust palette and was
 * previously copied byte-for-byte in CrustMeteringStrip and
 * CrustWaveformDisplay; a single source keeps the thresholds and hex literals
 * from drifting between the two views.
 */

export function grColor(gr: number): string {
    const abs = Math.abs(gr);
    if (abs <= 1) {
        return '#E8E6E0';
    }
    if (abs <= 4) {
        return '#D4A847';
    }
    if (abs <= 8) {
        return '#C87C2A';
    }
    return '#C44030';
}

/** Text uses theme-aware roles; canvas and meter fills keep the fixed DSP palette above. */
export function grTextColor(gr: number): string {
    const abs = Math.abs(gr);
    if (abs <= 1) {
        return 'var(--color-text-primary)';
    }
    if (abs <= 4) {
        return 'var(--color-state-warning)';
    }
    if (abs <= 8) {
        return 'var(--color-accent-orange)';
    }
    return 'var(--color-state-danger)';
}
