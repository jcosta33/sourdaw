import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LatchButton } from '../LatchButton';

const tokens = readTokens();

function readTokens(): ReadonlyMap<string, string> {
    const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    return new Map(
        [...stylesheet.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)].map(([, name, value]) => [
            name ?? '',
            value?.trim() ?? '',
        ])
    );
}

function resolveToken(name: string, visited = new Set<string>()): string {
    if (visited.has(name)) {
        throw new Error(`Cyclic design token reference: ${name}`);
    }
    const value = tokens.get(name);
    if (value === undefined) {
        throw new Error(`Unknown design token: ${name}`);
    }
    const reference = /^var\((--[\w-]+)\)$/u.exec(value);
    if (reference !== null) {
        visited.add(name);
        return resolveToken(reference[1] ?? '', visited);
    }
    return value;
}

function splitTopLevel(value: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;
        if (character === ',' && depth === 0) {
            parts.push(value.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(value.slice(start).trim());
    return parts;
}

function parseHex(value: string): readonly [number, number, number] {
    const match = /^#([\da-f]{6})$/iu.exec(value);
    if (match === null) {
        throw new Error(`Unsupported contrast color: ${value}`);
    }
    const hex = match[1] ?? '';
    return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
    ];
}

function colorAtStop(stop: string): readonly [number, number, number] {
    const color = stop.replace(/\s+\d+(?:\.\d+)?%$/u, '');
    if (color.startsWith('color-mix(') && color.endsWith(')')) {
        const [method, ...mixParts] = splitTopLevel(color.slice('color-mix('.length, -1));
        if (method !== 'in srgb' || mixParts.length !== 2) {
            throw new Error(`Unsupported gradient color mix: ${color}`);
        }
        const first = /^(.+?)\s+(\d+(?:\.\d+)?)%$/u.exec(mixParts[0] ?? '');
        const second = /^(.+?)(?:\s+(\d+(?:\.\d+)?)%)?$/u.exec(mixParts[1] ?? '');
        if (first === null || second === null) {
            throw new Error(`Unreadable gradient color mix: ${color}`);
        }
        const firstColor = colorAtStop(first[1] ?? '');
        const secondColor = colorAtStop(second[1] ?? '');
        const firstWeight = Number(first[2]) / 100;
        const secondWeight = second[2] === undefined ? 1 - firstWeight : Number(second[2]) / 100;
        const total = firstWeight + secondWeight;
        const mixed = firstColor.map((channel, index) => {
            const other = secondColor[index] ?? 0;
            return (channel * firstWeight + other * secondWeight) / total;
        });
        return [mixed[0] ?? 0, mixed[1] ?? 0, mixed[2] ?? 0];
    }
    const token = /^var\((--[\w-]+)\)$/u.exec(color);
    return parseHex(token === null ? color : resolveToken(token[1] ?? ''));
}

function activeGradientColors(background: string): readonly (readonly [number, number, number])[] {
    const gradient = /^linear-gradient\(180deg,\s*(.*)\)$/u.exec(background);
    if (gradient === null) {
        throw new Error(`Unexpected active LatchButton background: ${background}`);
    }
    return splitTopLevel(gradient[1] ?? '').map((stop) => colorAtStop(stop));
}

function relativeLuminance([red, green, blue]: readonly [number, number, number]): number {
    const linear = (channel: number): number => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrastRatio(
    foreground: readonly [number, number, number],
    background: readonly [number, number, number]
): number {
    const values = [relativeLuminance(foreground), relativeLuminance(background)].sort((left, right) => right - left);
    return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

function renderedForegroundColor(label: string): readonly [number, number, number] {
    const button = screen.getByRole('button', { name: label });
    const text = button.querySelector('span');
    if (text === null) {
        throw new Error('LatchButton has no rendered text wrapper');
    }
    const colorClass = [...text.classList].find((name) => name.startsWith('text-'));
    if (colorClass === undefined) {
        throw new Error('LatchButton has no active foreground color class');
    }
    return parseHex(resolveToken(`--color-${colorClass.slice('text-'.length)}`));
}

describe('LatchButton active contrast', () => {
    it('uses WCAG relative luminance contrast ratios', () => {
        expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 10);
        expect(contrastRatio([32, 32, 32], [32, 32, 32])).toBe(1);
    });

    it('keeps every active variant above the 4.5:1 foreground contract on every declared gradient stop', () => {
        const variants = ['cyan', 'mint', 'amber', 'red', 'neutral'] as const;
        for (const variant of variants) {
            const label = `Latch ${variant}`;
            render(
                <LatchButton active variant={variant}>
                    {label}
                </LatchButton>
            );
            const button = screen.getByRole('button', { name: label });
            const foreground = renderedForegroundColor(label);
            const backgrounds = activeGradientColors(button.style.background);
            expect(backgrounds).toHaveLength(3);
            for (const [index, background] of backgrounds.entries()) {
                expect(
                    contrastRatio(foreground, background),
                    `${variant} active foreground at gradient stop ${index + 1}`
                ).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    it('uses the existing bright red accent for active record text', () => {
        render(
            <LatchButton active variant="red">
                Record
            </LatchButton>
        );
        const button = screen.getByRole('button', { name: 'Record' });
        expect(button.querySelector('span')?.className).toContain('text-accent-red');
        const foreground = renderedForegroundColor('Record');
        for (const background of activeGradientColors(button.style.background)) {
            expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
    });
});
