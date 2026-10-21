#!/usr/bin/env bash
# Runs one command whose apt reads every configured source except the hosted
# runner image's standalone Microsoft product feed (#5359).
#
# The Ubuntu runner image enables https://packages.microsoft.com/ubuntu/<release>/prod,
# which nothing in these workflows installs from. When that feed answers 403,
# `apt-get update` exits 100 and fails every apt route on the runner. The
# command instead sees a temporary copy of the source configuration through
# APT_CONFIG, which the command and every apt it starts inherit, so Playwright's
# own apt runs are covered too. Each kept source file is copied byte for byte,
# keeping its entries and their Signed-By keys; only a file whose every enabled
# entry is that feed is left out. The system configuration is never edited.
#
# Usage: bash scripts/aptWithoutMicrosoftFeed.sh <command> [argument...]
#
# Exits with the command's own status, so an apt failure stays fatal. Refuses
# with status 2, before running the command, when a source file mixes the feed
# with other entries, a source file is unreadable, no enabled entry signed by
# the Ubuntu archive key remains, or apt does not read the copy.
set -euo pipefail

# The feed is this prefix followed by an Ubuntu release and /prod.
readonly MICROSOFT_FEED_PREFIX='https://packages.microsoft.com/ubuntu/'
readonly MICROSOFT_FEED_RELEASE='^[0-9]+[.][0-9]+/prod/?$'
readonly UBUNTU_ARCHIVE_KEY='ubuntu-archive-keyring'

refuse() {
  printf 'aptWithoutMicrosoftFeed: %s\n' "$1" >&2
  exit 2
}

# Prints "<enabled entries> <feed entries> <mixed stanzas> <Ubuntu-signed entries>"
# for one one-line-style (.list) or deb822 (.sources) file. The values pass
# through the environment because awk -v would rewrite their backslashes.
summarize_sources() {
  FORMAT=$1 PREFIX=$MICROSOFT_FEED_PREFIX RELEASE=$MICROSOFT_FEED_RELEASE KEY=$UBUNTU_ARCHIVE_KEY awk '
    BEGIN {
      format = ENVIRON["FORMAT"]; prefix = ENVIRON["PREFIX"]; release = ENVIRON["RELEASE"]; key = ENVIRON["KEY"]
    }
    function is_feed(uri) {
      return index(uri, prefix) == 1 && substr(uri, length(prefix) + 1) ~ release
    }
    function finish_stanza(    count, uris, i, named, feeds) {
      if (stanza_has_types && tolower(stanza_enabled) != "no") {
        count = split(stanza_uris, uris, /[ \t]+/)
        named = 0
        feeds = 0
        for (i = 1; i <= count; i++) {
          if (uris[i] == "") continue
          named++
          if (is_feed(uris[i])) feeds++
        }
        entries++
        if (feeds > 0 && feeds == named) feed_entries++
        else if (feeds > 0) mixed++
        else if (index(stanza_signed, key) > 0) signed++
      }
      stanza_has_types = 0; stanza_enabled = "yes"; stanza_uris = ""; stanza_signed = ""; field = ""
    }
    format == "list" {
      line = $0
      sub(/#.*/, "", line)
      if (line !~ /^[ \t]*deb(-src)?[ \t]/) next
      sub(/^[ \t]*deb(-src)?[ \t]+/, "", line)
      options = ""
      if (substr(line, 1, 1) == "[") {
        options = substr(line, 1, index(line, "]"))
        line = substr(line, index(line, "]") + 1)
      }
      split(line, words, /[ \t]+/)
      uri = (words[1] == "") ? words[2] : words[1]
      entries++
      if (is_feed(uri)) feed_entries++
      else if (options ~ /signed-by=/ && index(options, key) > 0) signed++
      next
    }
    format == "sources" && /^[ \t]*$/ { finish_stanza(); next }
    format == "sources" && /^#/ { next }
    format == "sources" && /^[ \t]/ {
      if (field == "uris") stanza_uris = stanza_uris " " $0
      if (field == "signed-by") stanza_signed = stanza_signed " " $0
      next
    }
    format == "sources" {
      field = tolower(substr($0, 1, index($0, ":") - 1))
      value = substr($0, index($0, ":") + 1)
      gsub(/^[ \t]+|[ \t]+$/, "", value)
      if (field == "types") stanza_has_types = 1
      if (field == "enabled") stanza_enabled = value
      if (field == "uris") stanza_uris = value
      if (field == "signed-by") stanza_signed = value
    }
    END {
      if (format == "sources") finish_stanza()
      printf "%d %d %d %d\n", entries, feed_entries, mixed, signed
    }
  ' "$2"
}

[ "$#" -gt 0 ] || refuse 'usage: aptWithoutMicrosoftFeed.sh <command> [argument...]'

SOURCE_LIST=''
SOURCE_PARTS=''
eval "$(apt-config shell SOURCE_LIST Dir::Etc::sourcelist/f SOURCE_PARTS Dir::Etc::sourceparts/d)"
[ -n "$SOURCE_LIST" ] && [ -n "$SOURCE_PARTS" ] || refuse 'apt-config named no source list locations'

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/sources.list.d"
signed_entries=0

# Copies one source file into the command's configuration unless the feed is
# its only enabled content; refuses a file that combines the feed with others.
admit_source() {
  local source=$1 target=$2 format=$3 summary entries feed_entries mixed signed
  [ -r "$source" ] || refuse "cannot read apt source file $source"
  summary=$(summarize_sources "$format" "$source")
  read -r entries feed_entries mixed signed <<< "$summary"
  if [ "$mixed" -gt 0 ] || { [ "$feed_entries" -gt 0 ] && [ "$feed_entries" -lt "$entries" ]; }; then
    refuse "$source combines the Microsoft product feed with other sources"
  fi
  if [ "$feed_entries" -gt 0 ]; then
    printf 'aptWithoutMicrosoftFeed: leaving out %s for this command\n' "$source" >&2
    return
  fi
  signed_entries=$((signed_entries + signed))
  cp -p -- "$source" "$target"
}

if [ -e "$SOURCE_LIST" ]; then
  admit_source "$SOURCE_LIST" "$work/sources.list" list
fi
if [ -d "$SOURCE_PARTS" ]; then
  for source in "${SOURCE_PARTS%/}"/*; do
    [ -f "$source" ] || continue
    case "$source" in
      *.list) admit_source "$source" "$work/sources.list.d/${source##*/}" list ;;
      *.sources) admit_source "$source" "$work/sources.list.d/${source##*/}" sources ;;
      *) cp -p -- "$source" "$work/sources.list.d/" ;;
    esac
  done
fi
[ "$signed_entries" -gt 0 ] || refuse 'no enabled apt source signed by the Ubuntu archive key would remain'

printf 'Dir::Etc::sourcelist "%s";\nDir::Etc::sourceparts "%s";\n' \
  "$work/sources.list" "$work/sources.list.d" > "$work/apt.conf"

# A later apt.conf.d entry could override the copy, so confirm what apt reads.
EFFECTIVE_LIST=''
EFFECTIVE_PARTS=''
eval "$(APT_CONFIG="$work/apt.conf" apt-config shell EFFECTIVE_LIST Dir::Etc::sourcelist/f EFFECTIVE_PARTS Dir::Etc::sourceparts/d)"
if [ "$EFFECTIVE_LIST" != "$work/sources.list" ] || [ "${EFFECTIVE_PARTS%/}" != "$work/sources.list.d" ]; then
  refuse "apt does not read the filtered sources (it reads $EFFECTIVE_LIST and $EFFECTIVE_PARTS)"
fi

status=0
APT_CONFIG="$work/apt.conf" "$@" || status=$?
exit "$status"
