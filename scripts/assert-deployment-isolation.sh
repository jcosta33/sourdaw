#!/bin/sh
set -eu

# Grades every public production domain of the deployment the daily web train
# just promoted for cross-origin isolation.
#
# SharedArrayBuffer — and therefore the audio engine's shared memory — is
# unavailable to a document that is not cross-origin isolated, and the two
# headers below are the whole of what makes it so. They are configured in
# `vercel.json`.
#
# Only production domains are public. Standard Protection restricts every
# generated deployment URL behind Vercel Authentication, so a request to one
# answers a redirect to `https://vercel.com/sso-api`; run 33850467688 followed
# that redirect, graded the vercel.com login page, and reported the deployment
# missing a header it was in fact serving. Nothing here follows a redirect, and
# an alias answering the Vercel Authentication redirect is skipped rather than
# graded — but a run in which no alias was graded fails, because a check that
# silently grades nothing is indistinguishable from one that passed.
#
# The alias list comes from the deployment record, so it proves the deployment
# took these aliases and no domain it never reached is graded. It does not
# prove the response came from this deployment: a rollback landing between the
# deploy and this check is graded as though it were this one.
#
# Both header matches are anchored to the whole line. `same-origin-allow-popups`
# contains `same-origin` and is not cross-origin isolated, so a substring match
# would pass a document SharedArrayBuffer is unavailable to.

: "${ALIASES:?ALIASES must be set to the public production aliases to grade}"
: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"

serves_header() {
    grep -iq "^$1:[[:space:]]*$2\$" "$3"
}

mkdir -p "$RUNNER_TEMP"
graded=0

for alias in $ALIASES; do
    response="$RUNNER_TEMP/deployment-response-$alias.txt"
    headers="$RUNNER_TEMP/deployment-headers-$alias.txt"
    curl --silent --show-error --head --max-time 30 "https://$alias/" > "$response"
    # curl terminates header lines with CRLF; the trailing CR would defeat the
    # end-of-line anchor both header matches depend on. Stripping it in a
    # second command rather than a pipeline keeps curl's own exit status.
    tr -d '\r' < "$response" > "$headers"
    status=$(awk 'NR == 1 { print $2 }' "$headers")

    case "$status" in
        3??)
            location=$(awk 'tolower($1) == "location:" { print $2; exit }' "$headers")
            case "$location" in
                'https://vercel.com/sso-api'*)
                    printf 'https://%s/ is behind Vercel Authentication; not a public production domain\n' "$alias"
                    continue
                    ;;
            esac
            ;;
    esac

    if [ "$status" != "200" ]; then
        printf 'https://%s/ answered %s\n' "$alias" "$status" >&2
        exit 1
    fi

    cat "$headers"

    if ! serves_header 'cross-origin-opener-policy' 'same-origin' "$headers"; then
        printf 'https://%s/ is missing cross-origin-opener-policy: same-origin\n' "$alias" >&2
        exit 1
    fi
    if ! serves_header 'cross-origin-embedder-policy' 'require-corp' "$headers"; then
        printf 'https://%s/ is missing cross-origin-embedder-policy: require-corp\n' "$alias" >&2
        exit 1
    fi

    graded=$((graded + 1))
    printf 'https://%s/ is cross-origin isolated\n' "$alias"
done

if [ "$graded" -eq 0 ]; then
    printf 'no public production domain answered for this deployment\n' >&2
    exit 1
fi
