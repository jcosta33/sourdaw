import { type HTMLAttributes, type Ref, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type CardProps = HTMLAttributes<HTMLDivElement> & {
    ref?: Ref<HTMLDivElement>;
};

export const Card = ({ className, ref, ...props }: CardProps): ReactElement => (
    <div ref={ref} className={cn('daw-panel-surface rounded-md text-text-primary', className)} {...props} />
);

type CardHeaderProps = HTMLAttributes<HTMLDivElement> & {
    ref?: Ref<HTMLDivElement>;
};

export const CardHeader = ({ className, ref, ...props }: CardHeaderProps): ReactElement => (
    <div ref={ref} className={cn('flex flex-col space-y-1 p-4 sm:p-5', className)} {...props} />
);

type CardTitleProps = HTMLAttributes<HTMLHeadingElement> & {
    ref?: Ref<HTMLHeadingElement>;
};

export const CardTitle = ({ className, ref, ...props }: CardTitleProps): ReactElement => (
    <h3
        ref={ref}
        className={cn('font-semibold leading-none tracking-[0.01em] text-text-primary', className)}
        {...props}
    />
);

type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement> & {
    ref?: Ref<HTMLParagraphElement>;
};

export const CardDescription = ({ className, ref, ...props }: CardDescriptionProps): ReactElement => (
    <p ref={ref} className={cn('text-xs text-text-secondary', className)} {...props} />
);

type CardContentProps = HTMLAttributes<HTMLDivElement> & {
    ref?: Ref<HTMLDivElement>;
};

export const CardContent = ({ className, ref, ...props }: CardContentProps): ReactElement => (
    <div ref={ref} className={cn('p-4 pt-0 sm:p-5 sm:pt-0', className)} {...props} />
);

type CardFooterProps = HTMLAttributes<HTMLDivElement> & {
    ref?: Ref<HTMLDivElement>;
};

export const CardFooter = ({ className, ref, ...props }: CardFooterProps): ReactElement => (
    <div ref={ref} className={cn('flex items-center p-4 pt-0 sm:p-5 sm:pt-0', className)} {...props} />
);
