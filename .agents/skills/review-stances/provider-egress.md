# Provider request content

When caller-authored records feed a provider request, trace the serialized body to every source
field. A production parser accepting a record proves its shape, not that all of its fields are
necessary or safe to send. Unknown metadata and reviewer baseline evidence must stay local when
the provider's questions need only stance names and admission lines.

Probe the real CLI with an offline fetch replacement. Put runtime-composed synthetic credential
shapes in an intended admission field and require refusal before fetch, with a diagnostic naming
the field and reason but never its value. Put the same shapes in excluded metadata and baseline
evidence and require those fields to disappear from the captured body while genuine admissions,
indexed questions, and verdicts remain aligned. Exercise the request builder directly too: a
manually constructed record must not bypass projection or screening.

## Escape: stance-checker caller content

[PR #4484](https://github.com/jcosta33/sourdaw/pull/4484), merged as
`4504a6987b8d4e8ec43ca2d408e7f1b8077d4eb6`, introduced the raw-state route:
`readStancesCheckRecord` returned `state: raw`, `buildStancesCheckBody` copied that state, and fetch
serialized the entire body. That admitted unknown fields and baseline-probe prose to the provider;
issue #4998 recorded an offline synthetic reproduction, not proof of live credential disclosure.

The missed risk was caller-content egress. The public review against the final head
`7c7a2bfc8662e3fb8df9802f14a44705de529b56` established that the API key appeared only in a Bearer
header and that the checker had no trusted-write or Gate authority. Those checks did not observe
credential-shaped values in the caller's request state. The retained local review bundle is
unavailable, so the historical stance name and dispatch wording cannot be established; the public
record supports a missing content probe, not a claim about a particular reviewer's tier.

The repair projects only `{ stance, admittedBy }` and uses the existing content screen on those
intended fields again at request construction. This is bounded defense in depth: the screen's
documented encoded or split-secret limitations still apply, and advisory status never makes
caller content safe to export.
