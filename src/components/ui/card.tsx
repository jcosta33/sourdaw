import { type HTMLAttributes, type Ref, type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

type CardProps = HTMLAttributes<HTMLDivElement> & {
    ref?: Ref<HTMLDivElement>;
};

export const Card = ({ className, ref, ...props }: CardProps): ReactElement => (
    <div
        ref={ref}
        className={cn(
            'rounded-md border border-border-soft border-t-[var(--color-light-edge)] bg-bg-panel text-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_2px_rgba(0,0,0,0.4)]',
            className
        )}
        {...props}
    />
);

type CardHeaderProps = HTMLAttributes<HTMLDivElement> & {
    ref?: Ref<HTMLDivElement>;
};

export const CardHeader = ({ className, ref, ...props }: CardHeaderProps): ReactElement => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
);

type CardTitleProps = HTMLAttributes<HTMLHeadingElement> & {
    ref?: Ref<HTMLParagraphElement>;
};

export const CardTitle = ({ className, ref, ...props }: CardTitleProps): ReactElement => (
    <h3 ref={ref} className={cn('font-semibold leading-none tracking-tight', className)} {...props} />
);

type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement> & {
    ref?: Ref<HTMLParagraphElement>;
};

export const CardDescription = ({ className, ref, ...props }: CardDescriptionProps): ReactElement => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
);

type CardContentProps = HTMLAttributes<HTMLDivElement> & {
    ref?: Ref<HTMLDivElement>;
};

export const CardContent = ({ className, ref, ...props }: CardContentProps): ReactElement => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
);

type CardFooterProps = HTMLAttributes<HTMLDivElement> & {
    ref?: Ref<HTMLDivElement>;
};

export const CardFooter = ({ className, ref, ...props }: CardFooterProps): ReactElement => (
    <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
);
