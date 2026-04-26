/** Inject an alpha value into an oklch() color string. */
export const colorWithAlpha = (color: string, alpha: number): string => {
    const match = color.match(/oklch\(([^)]+)\)/);
    if (match) {
        const base = match[1]!.replace(/\s*\/\s*[\d.]+\s*$/, '').trim();
        return `oklch(${base} / ${alpha})`;
    }
    return color;
};

/** Return a brighter version of an oklch color (for selected notes). */
export const brightenColor = (color: string, amount: number = 0.18): string => {
    const match = color.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
    if (match) {
        const length = Math.min(1, parseFloat(match[1]!) + amount);
        const context = parseFloat(match[2]!);
        const h = parseFloat(match[3]!);
        return `oklch(${length.toFixed(3)} ${context} ${h})`;
    }
    return color;
};
