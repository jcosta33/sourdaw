export const EFFECT_DISCLOSURE_TIERS = ['play', 'shape', 'build', 'route', 'lab'] as const;

export type EffectDisclosureTier = (typeof EFFECT_DISCLOSURE_TIERS)[number];

export function effectDisclosureTierFromLevel(level: unknown): EffectDisclosureTier {
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 5) {
        return 'play';
    }
    return EFFECT_DISCLOSURE_TIERS[level - 1] ?? 'play';
}

export function effectDisclosureLevel(tier: EffectDisclosureTier): 1 | 2 | 3 | 4 | 5 {
    switch (tier) {
        case 'play':
            return 1;
        case 'shape':
            return 2;
        case 'build':
            return 3;
        case 'route':
            return 4;
        case 'lab':
            return 5;
    }
    return 1;
}

export function isEffectDisclosureTier(value: unknown): value is EffectDisclosureTier {
    return typeof value === 'string' && EFFECT_DISCLOSURE_TIERS.some((tier) => tier === value);
}

export function isEffectDisclosureStageVisible(selected: EffectDisclosureTier, stage: EffectDisclosureTier): boolean {
    return EFFECT_DISCLOSURE_TIERS.indexOf(selected) >= EFFECT_DISCLOSURE_TIERS.indexOf(stage);
}
