import { type ReactElement } from 'react';

import { EFFECT_DISCLOSURE_TIERS, type EffectDisclosureTier } from '#/utils/UI/effectDisclosureTier';

import { DawPluginChip } from './DawPluginChip';

type Props = {
    tier: EffectDisclosureTier;
    onChange: (tier: EffectDisclosureTier) => void;
    tone?: 'copper' | 'neutral' | 'amber';
    options?: readonly EffectDisclosureTier[];
    labels?: Partial<Record<EffectDisclosureTier, string>>;
    groupLabel?: string;
};

export function DawEffectDisclosure({
    tier,
    onChange,
    tone = 'neutral',
    options = EFFECT_DISCLOSURE_TIERS,
    labels,
    groupLabel = 'Effect control detail',
}: Props): ReactElement {
    return (
        <div role="group" aria-label={groupLabel} className="flex flex-wrap items-stretch gap-1.5">
            {options.map((option) => (
                <DawPluginChip
                    key={option}
                    active={tier === option}
                    aria-pressed={tier === option}
                    tone={tone}
                    size="sm"
                    onClick={() => onChange(option)}
                >
                    {labels?.[option] ?? option}
                </DawPluginChip>
            ))}
        </div>
    );
}
