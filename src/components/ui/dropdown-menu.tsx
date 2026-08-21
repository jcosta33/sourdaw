import * as React from 'react';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight, Circle } from 'lucide-react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

type DropdownMenuSubTriggerProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
    ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>>;
};

function DropdownMenuSubTrigger({ className, inset, children, ref, ...props }: DropdownMenuSubTriggerProps) {
    return (
        <DropdownMenuPrimitive.SubTrigger
            ref={ref}
            className={cn(
                'flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none transition-[background,color,box-shadow] focus:bg-white/[0.06] data-[state=open]:bg-white/[0.06] [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
                inset ? 'pl-8' : '',
                className
            )}
            {...props}
        >
            {children}
            <ChevronRight className="ml-auto text-text-tertiary" />
        </DropdownMenuPrimitive.SubTrigger>
    );
}
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

type DropdownMenuSubContentProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> & {
    ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.SubContent>>;
};

function DropdownMenuSubContent({ className, ref, ...props }: DropdownMenuSubContentProps) {
    return (
        <DropdownMenuPrimitive.SubContent
            ref={ref}
            className={cn(
                'daw-floating-surface z-50 min-w-[10rem] overflow-hidden rounded-md p-1 text-popover-foreground',
                'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2',
                'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]',
                className
            )}
            {...props}
        />
    );
}
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

type DropdownMenuContentProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.Content>>;
};

function DropdownMenuContent({ className, sideOffset = 6, ref, ...props }: DropdownMenuContentProps) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(
                    'daw-floating-surface z-50 max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] min-w-[10rem] overflow-y-auto overflow-x-hidden rounded-md p-1 text-popover-foreground',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2',
                    'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-dropdown-menu-content-transform-origin]',
                    className
                )}
                {...props}
            />
        </DropdownMenuPrimitive.Portal>
    );
}
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
    ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.Item>>;
};

function DropdownMenuItem({ className, inset, ref, ...props }: DropdownMenuItemProps) {
    return (
        <DropdownMenuPrimitive.Item
            ref={ref}
            className={cn(
                'relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] text-text-primary outline-none transition-[background,color,box-shadow]',
                'focus:bg-white/[0.06] focus:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0',
                inset ? 'pl-8' : '',
                className
            )}
            {...props}
        />
    );
}
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

type DropdownMenuCheckboxItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> & {
    ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>>;
};

function DropdownMenuCheckboxItem({ className, children, checked, ref, ...props }: DropdownMenuCheckboxItemProps) {
    return (
        <DropdownMenuPrimitive.CheckboxItem
            ref={ref}
            className={cn(
                'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-[11px] text-text-primary outline-none transition-[background,color]',
                'focus:bg-white/[0.06] focus:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
                className
            )}
            checked={checked}
            {...props}
        >
            <Row as="span" justify="center" className="absolute left-2 h-3.5 w-3.5 text-accent-cyan">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Check className="h-4 w-4" />
                </DropdownMenuPrimitive.ItemIndicator>
            </Row>
            {children}
        </DropdownMenuPrimitive.CheckboxItem>
    );
}
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

type DropdownMenuRadioItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> & {
    ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>>;
};

function DropdownMenuRadioItem({ className, children, ref, ...props }: DropdownMenuRadioItemProps) {
    return (
        <DropdownMenuPrimitive.RadioItem
            ref={ref}
            className={cn(
                'relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-[11px] text-text-primary outline-none transition-[background,color]',
                'focus:bg-white/[0.06] focus:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
                className
            )}
            {...props}
        >
            <Row as="span" justify="center" className="absolute left-2 h-3.5 w-3.5 text-accent-cyan">
                <DropdownMenuPrimitive.ItemIndicator>
                    <Circle className="h-2 w-2 fill-current" />
                </DropdownMenuPrimitive.ItemIndicator>
            </Row>
            {children}
        </DropdownMenuPrimitive.RadioItem>
    );
}
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

type DropdownMenuLabelProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
    ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.Label>>;
};

function DropdownMenuLabel({ className, inset, ref, ...props }: DropdownMenuLabelProps) {
    return (
        <DropdownMenuPrimitive.Label
            ref={ref}
            className={cn(
                'px-2 py-1.5 text-[10px] font-semibold tracking-[0.18em] text-text-tertiary uppercase',
                inset ? 'pl-8' : '',
                className
            )}
            {...props}
        />
    );
}
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

type DropdownMenuSeparatorProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator> & {
    ref?: React.Ref<React.ElementRef<typeof DropdownMenuPrimitive.Separator>>;
};

function DropdownMenuSeparator({ className, ref, ...props }: DropdownMenuSeparatorProps) {
    return (
        <DropdownMenuPrimitive.Separator
            ref={ref}
            className={cn('-mx-1 my-1 h-px bg-white/[0.06]', className)}
            {...props}
        />
    );
}
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
    return (
        <span
            className={cn('ml-auto text-[10px] tracking-[0.18em] text-text-tertiary uppercase', className)}
            {...props}
        />
    );
};
DropdownMenuShortcut.displayName = 'DropdownMenuShortcut';

export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuCheckboxItem,
    DropdownMenuRadioItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuGroup,
    DropdownMenuPortal,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuRadioGroup,
};
