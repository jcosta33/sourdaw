import { type ReactElement, useState } from 'react';

import { Plus } from 'lucide-react';

import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

import { type AutomationMode } from '../../../models/TrackViewTypes';
import { AUTOMATION_MODE_CONFIG } from '../../helpers/automationViewHelpers';

export const AUTOMATION_MODE_OPTIONS: { value: AutomationMode; label: string }[] = [
    { value: 'read', label: 'Read' },
    { value: 'touch', label: 'Touch' },
    { value: 'latch', label: 'Latch' },
    { value: 'write', label: 'Write' },
    { value: 'off', label: 'Off' },
];

type AutomationParamOption = {
    id: string;
    name: string;
};

type AutomationModeControlProps = {
    automationMode: AutomationMode;
    laneCount: number;
    onModeChange: (mode: AutomationMode) => void;
    align?: 'left' | 'right';
    className?: string;
};

export const AutomationModeControl = ({
    automationMode,
    laneCount,
    onModeChange,
    align = 'left',
    className,
}: AutomationModeControlProps): ReactElement => {
    const [open, setOpen] = useState(false);
    const modeConfig = AUTOMATION_MODE_CONFIG[automationMode];
    const menuPositionClassName = align === 'right' ? 'right-0' : 'left-2';

    return (
        <div className={cn('relative flex items-center gap-1.5', className)}>
            <DawEyebrowLabel>Mode</DawEyebrowLabel>
            <Button
                variant="bare"
                size="bare"
                type="button"
                data-testid="automation-mode-button"
                className={cn(
                    'rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider transition-colors',
                    automationMode === 'write' ? 'animate-pulse' : ''
                )}
                style={{
                    backgroundColor: `${modeConfig.color}20`,
                    color: modeConfig.textColor,
                    border: `1px solid ${modeConfig.color}40`,
                }}
                onClick={(event) => {
                    event.stopPropagation();
                    setOpen(!open);
                }}
                aria-label={`Automation mode: ${automationMode}`}
            >
                {modeConfig.label}
            </Button>

            {open ? (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={(event) => {
                            event.stopPropagation();
                            setOpen(false);
                        }}
                    />
                    <div
                        className={cn(
                            'daw-floating-surface absolute top-full z-50 mt-1 min-w-[100px] rounded-md py-1',
                            menuPositionClassName
                        )}
                    >
                        {AUTOMATION_MODE_OPTIONS.map((option) => {
                            const config = AUTOMATION_MODE_CONFIG[option.value];
                            return (
                                <Button
                                    variant="bare"
                                    size="bare"
                                    type="button"
                                    key={option.value}
                                    className={cn(
                                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent/50',
                                        automationMode === option.value ? 'font-medium' : ''
                                    )}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onModeChange(option.value);
                                        setOpen(false);
                                    }}
                                >
                                    <span className="size-2 rounded-full" style={{ backgroundColor: config.color }} />
                                    <span
                                        style={{
                                            color: automationMode === option.value ? config.textColor : undefined,
                                        }}
                                    >
                                        {option.label}
                                    </span>
                                </Button>
                            );
                        })}
                    </div>
                </>
            ) : null}

            <span className="ml-auto text-[9px] text-muted-foreground">
                {laneCount} lane{laneCount !== 1 ? 's' : ''}
            </span>
        </div>
    );
};

type AutomationAddLaneControlProps = {
    params: AutomationParamOption[];
    onAdd: (paramId: string, paramName: string) => void;
    showAvailableCount?: boolean;
    className?: string;
};

export const AutomationAddLaneControl = ({
    params,
    onAdd,
    showAvailableCount = false,
    className,
}: AutomationAddLaneControlProps): ReactElement => {
    const [open, setOpen] = useState(false);

    return (
        <div className={cn('relative', className)}>
            <Button
                variant="bare"
                size="bare"
                type="button"
                className="flex w-full items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setOpen((current) => !current)}
            >
                <Plus className="size-3" />
                Add Lane
                {showAvailableCount && params.length > 0 ? (
                    <span className="ml-auto text-[8px] text-muted-foreground/40">{params.length} available</span>
                ) : null}
            </Button>

            {open ? (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                    <div className="daw-floating-surface absolute left-0 top-full z-50 mt-1 max-h-[300px] min-w-[200px] overflow-y-auto rounded-md py-1">
                        <DawEyebrowLabel className="block px-2 py-1 text-[8px]">Add parameter</DawEyebrowLabel>
                        <div className="max-h-[200px] overflow-y-auto">
                            {params.map((param) => (
                                <Button
                                    variant="bare"
                                    size="bare"
                                    type="button"
                                    key={param.id}
                                    className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[10px] text-foreground transition-colors hover:bg-accent/50"
                                    onClick={() => {
                                        onAdd(param.id, param.name);
                                        setOpen(false);
                                    }}
                                >
                                    <Plus className="size-2.5 text-muted-foreground/50" />
                                    {param.name}
                                </Button>
                            ))}
                            {params.length === 0 ? (
                                <div className="px-2.5 py-2 text-[10px] italic text-muted-foreground/50">
                                    All parameters have lanes
                                </div>
                            ) : null}
                        </div>
                    </div>
                </>
            ) : null}
        </div>
    );
};
