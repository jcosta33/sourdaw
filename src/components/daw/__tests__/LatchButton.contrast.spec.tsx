import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LatchButton } from '../LatchButton';

const tokens = readTokens();

function readTokens(): ReadonlyMap<string, string> {
    const stylesheet = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
    const entries = Array.from(stylesheet.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu), (match): [string, string] => {
        const name = match[1];
        const value = match[2];
        if (name === undefined || value === undefined) {
            throw new Error('Unreadable design token declaration');
        }
        return [name, value.trim()];
    });
    return new Map(entries);
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
        const referencedName = reference[1];
        if (referencedName === undefined) {
            throw new Error(`Unreadable design token reference: ${value}`);
        }
        visited.add(name);
        return resolveToken(referencedName, visited);
    }
    return value;
}

function splitTopLevel(value: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (character === '(') {
            depth += 1;
        }
        if (character === ')') {
            depth -= 1;
        }
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
    const hex = match[1];
    if (hex === undefined) {
        throw new Error(`Unreadable contrast color: ${value}`);
    }
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
        const firstPart = mixParts[0];
        const secondPart = mixParts[1];
        if (firstPart === undefined || secondPart === undefined) {
            throw new Error(`Unreadable gradient color mix: ${color}`);
        }
        const first = /^(.+?)\s+(\d+(?:\.\d+)?)%$/u.exec(firstPart);
        const second = /^(.+?)(?:\s+(\d+(?:\.\d+)?)%)?$/u.exec(secondPart);
        if (first === null || second === null) {
            throw new Error(`Unreadable gradient color mix: ${color}`);
        }
        const firstExpression = first[1];
        const firstPercentage = first[2];
        const secondExpression = second[1];
        if (firstExpression === undefined || firstPercentage === undefined || secondExpression === undefined) {
            throw new Error(`Unreadable gradient color mix: ${color}`);
        }
        const firstColor = colorAtStop(firstExpression);
        const secondColor = colorAtStop(secondExpression);
        const firstWeight = Number(firstPercentage) / 100;
        const secondWeight = second[2] === undefined ? 1 - firstWeight : Number(second[2]) / 100;
        const total = firstWeight + secondWeight;
        const [firstRed, firstGreen, firstBlue] = firstColor;
        const [secondRed, secondGreen, secondBlue] = secondColor;
        return [
            (firstRed * firstWeight + secondRed * secondWeight) / total,
            (firstGreen * firstWeight + secondGreen * secondWeight) / total,
            (firstBlue * firstWeight + secondBlue * secondWeight) / total,
        ];
    }
    const token = /^var\((--[\w-]+)\)$/u.exec(color);
    if (token === null) {
        return parseHex(color);
    }
    const tokenName = token[1];
    if (tokenName === undefined) {
        throw new Error(`Unreadable gradient token reference: ${color}`);
    }
    return parseHex(resolveToken(tokenName));
}

function activeGradientColors(background: string): readonly (readonly [number, number, number])[] {
    const gradient = /^linear-gradient\(180deg,\s*(.*)\)$/u.exec(background);
    if (gradient === null) {
        throw new Error(`Unexpected active LatchButton background: ${background}`);
    }
    const stops = gradient[1];
    if (stops === undefined) {
        throw new Error(`Unreadable active LatchButton gradient: ${background}`);
    }
    return splitTopLevel(stops).map((stop) => colorAtStop(stop));
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
    const foregroundLuminance = relativeLuminance(foreground);
    const backgroundLuminance = relativeLuminance(background);
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
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
