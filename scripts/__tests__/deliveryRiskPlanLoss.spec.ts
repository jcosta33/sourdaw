import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { shellPort } from '../deliverPullRequest.ts';
import { reviewBundlePath } from '../reviewBundleLocator.ts';
import { appendReviewDossierEvents, assembleReviewDossier } from '../reviewDossier.ts';

import type { ReviewRiskPlan } from '../reviewRiskPolicy.ts';

const PR = 42;
const HEAD = 'reviewed-head';
const BASE = 'reviewed-base';
const roots: string[] = [];

function bundleFixture(generated: unknown): { root: string; bundle: string } {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-delivery-risk-plan-'));
    roots.push(root);
    const bundle = reviewBundlePath(root, PR, HEAD);
    mkdirSync(bundle, { recursive: true });
    writeFileSync(
        join(bundle, 'manifest.json'),
        JSON.stringify({ pr: PR, baseRefName: 'main', baseSha: BASE, headSha: HEAD, generated })
    );
    return { root, bundle };
}

function authorizationReader(root: string) {
    return shellPort(
        'jcosta33/sourdaw',
        {
            capture: () => {
                throw new Error('delivery authorization must not call GitHub');
            },
            run: () => {
                throw new Error('delivery authorization must not mutate GitHub');
            },
        },
        { primaryRoot: root }
    ).reviewBundleDeliveryAuthorization;
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe('delivery risk-plan provenance at the production shell port', () => {
    it('refuses a missing generated modern risk plan before granting legacy delivery', () => {
        const { root } = bundleFixture(['manifest.json', 'risk-plan.json']);

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/missing review risk plan at .*risk-plan\.json/u);
    });

    it('admits a genuine pre-plan bundle whose generated list excludes the risk plan', () => {
        const { root } = bundleFixture(['manifest.json', 'review-size.json']);

        expect(authorizationReader(root)(PR, HEAD)).toEqual({ kind: 'legacy' });
    });

    it('admits a historical pre-plan manifest written before baseRefName was recorded', () => {
        const generated = ['diff.patch', 'manifest.json', 'pr.md'];
        const { root, bundle } = bundleFixture(generated);
        writeFileSync(
            join(bundle, 'manifest.json'),
            JSON.stringify({ pr: PR, baseSha: BASE, headSha: HEAD, generated })
        );

        expect(authorizationReader(root)(PR, HEAD)).toEqual({ kind: 'legacy' });
    });

    it('admits the original three-field pre-plan manifest before generated was recorded', () => {
        const { root, bundle } = bundleFixture(['manifest.json']);
        writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ pr: PR, baseSha: BASE, headSha: HEAD }));

        expect(authorizationReader(root)(PR, HEAD)).toEqual({ kind: 'legacy' });
    });

    it.each([
        ['another PR', { pr: PR + 1, baseSha: BASE, headSha: HEAD }],
        ['another head', { pr: PR, baseSha: BASE, headSha: 'other-head' }],
        ['an empty base SHA', { pr: PR, baseSha: '', headSha: HEAD }],
        ['an unproven extra field', { pr: PR, baseSha: BASE, headSha: HEAD, extra: true }],
    ])('refuses original manifest provenance with %s', (_label, manifest) => {
        const { root, bundle } = bundleFixture(['manifest.json']);
        writeFileSync(join(bundle, 'manifest.json'), JSON.stringify(manifest));

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/invalid provenance/u);
    });

    it('refuses a missing plan recorded by a manifest without baseRefName', () => {
        const generated = ['manifest.json', 'risk-plan.json'];
        const { root, bundle } = bundleFixture(generated);
        writeFileSync(
            join(bundle, 'manifest.json'),
            JSON.stringify({ pr: PR, baseSha: BASE, headSha: HEAD, generated })
        );

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/missing review risk plan/u);
    });

    it.each([
        ['another PR', { pr: PR + 1 }],
        ['another head', { headSha: 'other-head' }],
        ['an empty base SHA', { baseSha: '' }],
        ['a non-string base SHA', { baseSha: null }],
        ['a malformed generated list', { generated: ['manifest.json', 7] }],
    ])('refuses historical manifest provenance with %s', (_label, override) => {
        const { root, bundle } = bundleFixture(['manifest.json']);
        writeFileSync(
            join(bundle, 'manifest.json'),
            JSON.stringify({ pr: PR, baseSha: BASE, headSha: HEAD, generated: ['manifest.json'], ...override })
        );

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/invalid provenance/u);
    });

    it.each([[''], [' '], [null], [7]])('refuses a present invalid baseRefName of %j', (baseRefName) => {
        const generated = ['manifest.json'];
        const { root, bundle } = bundleFixture(generated);
        writeFileSync(
            join(bundle, 'manifest.json'),
            JSON.stringify({ pr: PR, baseRefName, baseSha: BASE, headSha: HEAD, generated })
        );

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/invalid provenance/u);
    });

    it.each([
        ['a malformed generated list', ['manifest.json', 7]],
        ['an absent generated list', undefined],
    ])('refuses %s instead of treating unknown provenance as legacy', (_label, generated) => {
        const { root } = bundleFixture(generated);

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/review bundle manifest/u);
    });

    it('refuses an absent manifest instead of treating unknown provenance as legacy', () => {
        const { root, bundle } = bundleFixture(['manifest.json']);
        rmSync(join(bundle, 'manifest.json'));

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/review bundle manifest/u);
    });

    it('refuses an unreadable manifest instead of treating unknown provenance as legacy', () => {
        const { root, bundle } = bundleFixture(['manifest.json']);
        writeFileSync(join(bundle, 'manifest.json'), '{ not json');

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/review bundle manifest/u);
    });

    it('refuses a legacy manifest bound to another head', () => {
        const { root, bundle } = bundleFixture(['manifest.json']);
        writeFileSync(
            join(bundle, 'manifest.json'),
            JSON.stringify({
                pr: PR,
                baseRefName: 'main',
                baseSha: BASE,
                headSha: 'other-head',
                generated: ['manifest.json'],
            })
        );

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/review bundle manifest/u);
    });

    it('refuses a surviving modern dossier when its risk plan is absent', () => {
        const { root, bundle } = bundleFixture(['manifest.json']);
        writeFileSync(join(bundle, 'dossier.json'), '{}');

        expect(() => authorizationReader(root)(PR, HEAD)).toThrow(/dossier but no risk plan/u);
    });

    it('continues reading a present plan dossier and its exact authorized evidence digest', () => {
        const { root, bundle } = bundleFixture(['manifest.json', 'risk-plan.json']);
        const plan: ReviewRiskPlan = {
            format: 'risk-plan-v1',
            pr: PR,
            headSha: HEAD,
            baseSha: BASE,
            riskClasses: ['small'],
            requiredStances: ['correctness', 'test-validity'],
            triggers: [],
        };
        const dossier = assembleReviewDossier({
            plan,
            events: [],
            discarded: [],
            evidence: [],
            limitations: [],
            recommendation: 'approve',
            assessmentImpact: 'none',
        });
        const published = appendReviewDossierEvents(dossier, [{ kind: 'review-published', reviewId: 77 }]);
        const authorized = appendReviewDossierEvents(published, [
            {
                kind: 'delivery-authorized',
                reviewId: 77,
                approvalReviewId: 77,
                evidenceManifestDigest: published.dossierDigest,
                unresolvedThreads: 0,
                intent: 'deliver',
            },
        ]);
        writeFileSync(join(bundle, 'risk-plan.json'), JSON.stringify(plan));
        writeFileSync(join(bundle, 'dossier.json'), JSON.stringify(authorized));

        expect(authorizationReader(root)(PR, HEAD)).toEqual({
            kind: 'required',
            authorization: {
                reviewId: 77,
                approvalReviewId: 77,
                evidenceManifestDigest: published.dossierDigest,
                unresolvedThreads: 0,
                intent: 'deliver',
            },
            dossierDigest: published.dossierDigest,
        });
    });
});
