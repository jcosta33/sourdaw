import { createRef } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Divider, Grid, Row, Stack } from '../index';

function exercisePublicTypeContract(): void {
    const buttonRef = createRef<HTMLButtonElement>();
    const divRef = createRef<HTMLDivElement>();
    const listRef = createRef<HTMLUListElement>();

    for (const gap of [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 8] as const) {
        void (<Stack gap={gap}>Stack gap fixture</Stack>);
        void (<Row gap={gap}>Row gap fixture</Row>);
        void (
            <Grid gap={gap} gapX={gap} gapY={gap}>
                Grid gap fixture
            </Grid>
        );
    }

    for (const align of ['start', 'center', 'end', 'stretch'] as const) {
        void (<Stack align={align}>Stack alignment fixture</Stack>);
    }
    for (const justify of ['start', 'center', 'end', 'between'] as const) {
        void (<Stack justify={justify}>Stack justification fixture</Stack>);
    }
    for (const align of ['start', 'center', 'end', 'stretch', 'baseline'] as const) {
        void (<Row align={align}>Row alignment fixture</Row>);
    }
    for (const justify of ['start', 'center', 'end', 'between', 'around', 'evenly'] as const) {
        void (<Row justify={justify}>Row justification fixture</Row>);
    }
    for (const cols of [1, 2, 3, 4, 5, 6] as const) {
        void (<Grid cols={cols}>Grid column fixture</Grid>);
    }
    for (const flow of ['row', 'col'] as const) {
        void (<Grid flow={flow}>Grid flow fixture</Grid>);
    }
    for (const axis of ['x', 'y'] as const) {
        void (<Divider axis={axis} />);
    }
    for (const tone of ['subtle', 'default', 'strong'] as const) {
        void (<Divider tone={tone} />);
    }
    for (const spacing of [0, 2, 3, 4] as const) {
        void (<Divider spacing={spacing} />);
    }

    void (
        <Stack
            as="ul"
            ref={listRef}
            gap={0.5}
            align="stretch"
            justify="between"
            grow
            shrink={false}
            wrap
            aria-label="Stack fixture"
        >
            <li>Stack child</li>
        </Stack>
    );
    // @ts-expect-error -- Stack rejects gap tokens outside its public scale.
    void (<Stack gap={5}>Invalid Stack gap</Stack>);
    // @ts-expect-error -- Stack alignment excludes Row's baseline option.
    void (<Stack align="baseline">Invalid Stack alignment</Stack>);
    // @ts-expect-error -- Stack justification excludes Row's around option.
    void (<Stack justify="around">Invalid Stack justification</Stack>);
    // @ts-expect-error -- Stack control flags accept booleans only.
    void (<Stack grow="yes">Invalid Stack grow</Stack>);
    // @ts-expect-error -- Stack polymorphism is limited to real React element types.
    void (<Stack as="not-a-real-element">Invalid Stack element</Stack>);
    void (
        <Stack as="button" type="button" ref={buttonRef}>
            Button Stack fixture
        </Stack>
    );

    void (
        <Row
            as="ul"
            ref={listRef}
            gap={1.5}
            align="baseline"
            justify="evenly"
            grow
            shrink={false}
            wrap
            aria-label="Row fixture"
        >
            <li>Row child</li>
        </Row>
    );
    // @ts-expect-error -- Row rejects gap tokens outside its public scale.
    void (<Row gap={5}>Invalid Row gap</Row>);
    // @ts-expect-error -- Row accepts only its documented alignment tokens.
    void (<Row align="safe">Invalid Row alignment</Row>);
    // @ts-expect-error -- Row accepts only its documented justification tokens.
    void (<Row justify="stretch">Invalid Row justification</Row>);
    // @ts-expect-error -- Row control flags accept booleans only.
    void (<Row wrap="yes">Invalid Row wrap</Row>);
    // @ts-expect-error -- Row polymorphism is limited to real React element types.
    void (<Row as="not-a-real-element">Invalid Row element</Row>);

    void (
        <Grid as="ul" ref={listRef} cols={5} gap={2.5} gapX={0.5} gapY={1.5} flow="col" aria-label="Grid fixture">
            <li>Grid child</li>
        </Grid>
    );
    // @ts-expect-error -- Grid supports exactly columns one through six.
    void (<Grid cols={7}>Invalid Grid columns</Grid>);
    // @ts-expect-error -- Grid rejects gap tokens outside its public scale.
    void (<Grid gap={5}>Invalid Grid gap</Grid>);
    // @ts-expect-error -- Grid flow accepts row or col only.
    void (<Grid flow="dense">Invalid Grid flow</Grid>);
    // @ts-expect-error -- Grid polymorphism is limited to real React element types.
    void (<Grid as="not-a-real-element">Invalid Grid element</Grid>);

    void (<Divider ref={divRef} axis="y" tone="strong" spacing={4} data-public-fixture="divider" />);
    // @ts-expect-error -- Divider axis accepts x or y only.
    void (<Divider axis="z" />);
    // @ts-expect-error -- Divider accepts only its three documented tones.
    void (<Divider tone="muted" />);
    // @ts-expect-error -- Divider accepts only its documented spacing tokens.
    void (<Divider spacing={1} />);
    // @ts-expect-error -- Divider remains a fixed div and has no as prop.
    void (<Divider as="hr" />);
}

void exercisePublicTypeContract;

describe('layout public barrel', () => {
    it('exports all four primitives for runtime consumers', () => {
        render(
            <Stack data-testid="stack">
                <Row data-testid="row">
                    <Grid data-testid="grid">
                        <Divider data-testid="divider" />
                    </Grid>
                </Row>
            </Stack>
        );

        expect(screen.getByTestId('stack')).toBeInTheDocument();
        expect(screen.getByTestId('row')).toBeInTheDocument();
        expect(screen.getByTestId('grid')).toBeInTheDocument();
        expect(screen.getByTestId('divider')).toBeInTheDocument();
    });
});
