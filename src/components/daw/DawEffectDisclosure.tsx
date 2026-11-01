import { type ReactElement } from 'react';

import { Row } from '#/components/layout';
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
        <Row role="group" aria-label={groupLabel} align="stretch" wrap gap={1.5}>
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
        </Row>
    );
}
