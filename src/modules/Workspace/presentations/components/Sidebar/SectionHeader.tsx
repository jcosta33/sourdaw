import { type ReactElement } from 'react';
import { DawSectionDivider } from '#/components/daw/DawSectionDivider';

type SectionHeaderProps = {
    label: string;
};

export const SectionHeader = ({ label }: SectionHeaderProps): ReactElement => (
    <DawSectionDivider label={label} className="mb-1.5 px-1 py-0.5" />
);
