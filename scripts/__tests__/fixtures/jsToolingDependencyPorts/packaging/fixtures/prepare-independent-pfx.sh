#!/bin/sh
# Run with the coherent Node26 installed graph and a private output directory.
# Disposable test identities only; no purchase, real signing identity or service.
set -eu
umask 077
: "${PACKAGING_REQUIRE_FROM:?Set the integrated lane package.json path}"
fixture_root=${PACKAGING_PFX_OUTPUT:?Set private fixture output directory}
mkdir -p -m 700 "$fixture_root"
fixture_root=$(mktemp -d "$fixture_root/vectors.XXXXXX")
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
assembler="$script_dir/assemble-independent-pfx.cjs"
openssl version -a > "$fixture_root/openssl-version.txt"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$fixture_root/rsa.key" -out "$fixture_root/rsa.crt" -subj '/CN=Sourdaw Fixture/O=Fixture Company' -addext 'extendedKeyUsage=codeSigning'
for algorithm in PBE-SHA1-3DES PBE-SHA1-2DES PBE-SHA1-RC2-128 PBE-SHA1-RC2-40; do
  openssl pkcs12 -provider default -provider legacy -export -in "$fixture_root/rsa.crt" -inkey "$fixture_root/rsa.key" -out "$fixture_root/$algorithm.pfx" -passout pass:fixture-password -certpbe "$algorithm" -keypbe "$algorithm" -macalg sha1 -iter 2048
done
for algorithm in AES-128-CBC AES-192-CBC AES-256-CBC; do
  openssl pkcs12 -export -in "$fixture_root/rsa.crt" -inkey "$fixture_root/rsa.key" -out "$fixture_root/$algorithm.pfx" -passout pass:fixture-password -certpbe "$algorithm" -keypbe "$algorithm" -macalg sha256 -iter 2048
done
node "$assembler" cert-safe "$fixture_root/rsa.crt" "$fixture_root/rsa-safe"
openssl cms -sign -binary -nodetach -nosmimecap -md sha256 -in "$fixture_root/rsa-safe/authsafe.der" -signer "$fixture_root/rsa.crt" -inkey "$fixture_root/rsa.key" -outform DER -out "$fixture_root/rsa-cms.der"
node "$assembler" wrap-cms "$fixture_root/rsa-cms.der" "$fixture_root/CMS-RSA.pfx"
openssl cms -sign -binary -nodetach -nosmimecap -md sha256 -in "$fixture_root/rsa-safe/authsafe.der" -signer "$fixture_root/rsa.crt" -inkey "$fixture_root/rsa.key" -keyopt rsa_padding_mode:pss -keyopt rsa_pss_saltlen:digest -outform DER -out "$fixture_root/rsa-pss-cms.der"
node "$assembler" wrap-cms "$fixture_root/rsa-pss-cms.der" "$fixture_root/CMS-RSA-PSS.pfx"
for curve in prime256v1 secp384r1 secp521r1; do
  openssl req -x509 -newkey ec -pkeyopt "ec_paramgen_curve:$curve" -nodes -days 3650 -keyout "$fixture_root/$curve.key" -out "$fixture_root/$curve.crt" -subj '/CN=Sourdaw Fixture/O=Fixture Company' -addext 'extendedKeyUsage=codeSigning'
  node "$assembler" cert-safe "$fixture_root/$curve.crt" "$fixture_root/$curve-safe"
  openssl cms -sign -binary -nodetach -nosmimecap -md sha256 -in "$fixture_root/$curve-safe/authsafe.der" -signer "$fixture_root/$curve.crt" -inkey "$fixture_root/$curve.key" -outform DER -out "$fixture_root/$curve-cms.der"
  node "$assembler" wrap-cms "$fixture_root/$curve-cms.der" "$fixture_root/CMS-$curve.pfx"
done
# Independent PBKDF2 SHA1 and AES256 cipher math; ASN.1 is encoded by published PKIJS.
salt=0102030405060708090a0b0c0d0e0f10
iv=101112131415161718191a1b1c1d1e1f
openssl kdf -keylen 32 -kdfopt digest:SHA1 -kdfopt pass:fixture-password -kdfopt "hexsalt:$salt" -kdfopt iter:2048 PBKDF2 > "$fixture_root/pbkdf2-key.txt"
key=$(tr -d ':\r\n ' < "$fixture_root/pbkdf2-key.txt")
if [ "${#key}" -ne 64 ]; then printf "%s\n" "Unexpected OpenSSL PBKDF2 output length" >&2; exit 1; fi
case "$key" in *[!0-9A-Fa-f]*) printf "%s\n" "Unexpected OpenSSL PBKDF2 output characters" >&2; exit 1;; esac
openssl enc -aes-256-cbc -K "$key" -iv "$iv" -in "$fixture_root/rsa-safe/safe-contents.der" -out "$fixture_root/pbes2-sha1-encrypted.bin"
for mode in pbes2-sha1-safe unsupported-safe; do
  node "$assembler" "$mode" "$fixture_root/pbes2-sha1-encrypted.bin" "$fixture_root/$mode.der"
  openssl cms -sign -binary -nodetach -nosmimecap -md sha256 -in "$fixture_root/$mode.der" -signer "$fixture_root/rsa.crt" -inkey "$fixture_root/rsa.key" -outform DER -out "$fixture_root/$mode-cms.der"
  node "$assembler" wrap-cms "$fixture_root/$mode-cms.der" "$fixture_root/$mode.pfx"
done
node "$assembler" empty-safe unused "$fixture_root/empty-safe"
openssl cms -sign -binary -nodetach -nosmimecap -md sha256 -in "$fixture_root/empty-safe/authsafe.der" -signer "$fixture_root/rsa.crt" -inkey "$fixture_root/rsa.key" -outform DER -out "$fixture_root/empty-cms.der"
node "$assembler" wrap-cms "$fixture_root/empty-cms.der" "$fixture_root/empty-safe.pfx"
node "$assembler" no-cert-safe "$fixture_root/rsa.key" "$fixture_root/no-cert-safe"
openssl cms -sign -binary -nodetach -nosmimecap -md sha256 -in "$fixture_root/no-cert-safe/authsafe.der" -signer "$fixture_root/rsa.crt" -inkey "$fixture_root/rsa.key" -outform DER -out "$fixture_root/no-cert-cms.der"
node "$assembler" wrap-cms "$fixture_root/no-cert-cms.der" "$fixture_root/no-cert-safe.pfx"
# Keep private outputs outside the repository. This candidate deletes nothing.
printf '%s\n' "$fixture_root"
