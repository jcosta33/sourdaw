import { type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { DawPluginChip } from './DawPluginChip';

type DawPluginToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    pressed: boolean;
    onLabel?: ReactNode;
    offLabel?: ReactNode;
    tone?: 'neutral' | 'amber' | 'cyan' | 'peach' | 'lavender' | 'mint' | 'steel' | 'danger';
    size?: 'xs' | 'sm';
    shape?: 'pill' | 'soft';
    caps?: boolean;
    children?: ReactNode;
};

export const DawPluginToggle = ({
    pressed,
    onLabel = 'ON',
    offLabel = 'OFF',
    tone = 'neutral',
    size = 'xs',
    shape = 'pill',
    caps = true,
    children,
    ...props
}: DawPluginToggleProps): ReactElement => (
    <DawPluginChip active={pressed} aria-pressed={pressed} tone={tone} size={size} shape={shape} caps={caps} {...props}>
        {children ?? (pressed ? onLabel : offLabel)}
    </DawPluginChip>
);
