import { type ReactElement } from 'react';

import { EFFECT_DISCLOSURE_TIERS, type EffectDisclosureTier } from '#/utils/UI/effectDisclosureTier';

import { DawPluginChip } from './DawPluginChip';

type Props = {
    tier: EffectDisclosureTier;
    onChange: (tier: EffectDisclosureTier) => void;
    tone?: 'copper' | 'neutral';
};

export function DawEffectDisclosure({ tier, onChange, tone = 'neutral' }: Props): ReactElement {
    return (
        <div role="group" aria-label="Effect control detail" className="flex flex-wrap items-stretch gap-1.5">
            {EFFECT_DISCLOSURE_TIERS.map((option) => (
                <DawPluginChip
                    key={option}
                    active={tier === option}
                    aria-pressed={tier === option}
                    tone={tone}
                    size="sm"
                    onClick={() => onChange(option)}
                >
                    {option}
                </DawPluginChip>
            ))}
        </div>
    );
}
