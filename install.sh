#!/bin/sh

set -eu
umask 077

REPOSITORY_URL="https://github.com/heyNag/codex-pet-grok-bot"
SOURCE_REF="6e8604c0ec7c9a1adb6b1e2211660d94b6630fad"
DEFAULT_SOURCE_BASE="https://raw.githubusercontent.com/heyNag/codex-pet-grok-bot/$SOURCE_REF"
RELEASE="1.3.0"
RECEIPT_NAME=".codex-pet-grok-bot-receipt"
JOURNAL_NAME="transaction-journal"
LOCK_OWNER_NAME="owner"
RECOVERY_CLAIM_NAME="recovery-claim"
STAGE_MARKER_NAME=".codex-pet-grok-bot-stage"
BACKUP_MARKER_NAME=".codex-pet-grok-bot-backup"
REMOVE_MARKER_NAME=".codex-pet-grok-bot-remove"

action="sync"
selection=""
codex_root=""
pets_root=""
backup_root=""
backup_run=""
backup_owned="0"
source_base=""
stage_root=""
stage_owned="0"
lock_path=""
lock_owned="0"
recovery_claim_owned="0"
journal_tmp=""
owner_tmp=""
transaction_token=""
transaction_active="0"
commit_publication_started="0"
rollback_failed="0"
remove_root=""
remove_owned="0"

dark_state=""
dark_result=""
dark_applied=""
dark_backup=""
light_state=""
light_result=""
light_applied=""
light_backup=""

usage() {
  cat <<'USAGE'
Install, update, or remove Grok Bot for Codex.

Usage:
  install.sh dark|light|both
  install.sh update dark|light|both
  install.sh remove dark|light|both

Examples:
  curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/heyNag/codex-pet-grok-bot/main/install.sh | sh -s -- dark
  curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/heyNag/codex-pet-grok-bot/main/install.sh | sh -s -- light

The one-argument form installs a missing pet, updates an unmodified pet
previously managed by this installer, or makes no changes when it is current.
The explicit update form requires the selected pet to be installed already.
The remove form deletes only an unmodified pet owned by this installer. A
missing selected pet is already removed and is left unchanged.

CODEX_HOME is honored when set; otherwise the destination is ~/.codex.
USAGE
}

fail() {
  printf 'Grok Bot installer: %s\n' "$*" >&2
  exit 1
}

set_variant_metadata() {
  meta_variant="$1"

  case "$meta_variant" in
    dark)
      meta_id="grok-bot-dark"
      meta_name="Grok Bot Dark"
      meta_manifest_sha="d969b71040a5e2b8939eb50bb4463729ae8797f08ad97105c8cf5ba98f4f5be0"
      meta_manifest_size="218"
      meta_sprite_sha="1909a53fe90d482332410e9ffb2d1a22d9adbfa548d74430df4f8ae26f96773f"
      meta_sprite_size="3075860"
      ;;
    light)
      meta_id="grok-bot-light"
      meta_name="Grok Bot Light"
      meta_manifest_sha="ca9cfa7e77a53719a031bc77e514b78766bb3b52fa2ca2c7c0d271f404fb46d1"
      meta_manifest_size="221"
      meta_sprite_sha="58824abc00ae809965f339761d72acc23ddfe34aef031a0df5b0dba13cfe4b11"
      meta_sprite_size="3072750"
      ;;
    *)
      fail "unsupported variant: $meta_variant"
      ;;
  esac
}

hash_file() {
  hash_path="$1"

  case "$hash_tool" in
    sha256sum)
      sha256sum "$hash_path" | awk '{print $1}'
      ;;
    shasum)
      shasum -a 256 "$hash_path" | awk '{print $1}'
      ;;
    openssl)
      openssl dgst -sha256 "$hash_path" | awk '{print $NF}'
      ;;
    *)
      return 1
      ;;
  esac
}

file_size() {
  wc -c < "$1" | tr -d '[:space:]'
}

is_sha256() {
  candidate_sha="$1"
  [ "${#candidate_sha}" -eq 64 ] || return 1

  case "$candidate_sha" in
    *[!0123456789abcdef]*) return 1 ;;
    *) return 0 ;;
  esac
}

verify_file() {
  verify_path="$1"
  expected_size="$2"
  expected_sha="$3"

  [ -f "$verify_path" ] && [ ! -L "$verify_path" ] \
    || fail "download did not produce a regular file: $(basename "$verify_path")"
  actual_size="$(file_size "$verify_path")"
  [ "$actual_size" = "$expected_size" ] \
    || fail "size verification failed for $(basename "$verify_path")"
  actual_sha="$(hash_file "$verify_path")"
  [ "$actual_sha" = "$expected_sha" ] \
    || fail "checksum verification failed for $(basename "$verify_path")"
}

download_file() {
  download_url="$1"
  download_destination="$2"

  curl \
    --proto '=https,file' \
    --proto-redir '=https' \
    --tlsv1.2 \
    --fail \
    --silent \
    --show-error \
    --location \
    "$download_url" \
    --output "$download_destination"
}

durability_barrier() {
  sync || return 1
}

move_path() {
  mv "$1" "$2"
}

link_file_no_replace() {
  ln "$1" "$2"
}

receipt_value() {
  receipt_key="$1"
  receipt_path="$2"
  awk -v wanted="$receipt_key" '
    index($0, wanted "=") == 1 {
      count += 1
      value = substr($0, length(wanted) + 2)
    }
    END {
      if (count != 1) exit 1
      print value
    }
  ' "$receipt_path"
}

process_is_alive() {
  process_pid="$1"
  if kill -0 "$process_pid" 2>/dev/null; then
    return 0
  fi

  # A permission error from kill -0 must not be mistaken for a dead process.
  if command -v ps >/dev/null 2>&1 && ps -p "$process_pid" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

directory_is_empty() {
  empty_directory="$1"
  for empty_entry in "$empty_directory"/* "$empty_directory"/.[!.]* "$empty_directory"/..?*; do
    if [ -e "$empty_entry" ] || [ -L "$empty_entry" ]; then
      return 1
    fi
  done
  return 0
}

directory_has_only_named_entries() {
  named_directory="$1"
  shift

  for named_entry in "$named_directory"/* "$named_directory"/.[!.]* "$named_directory"/..?*; do
    if [ ! -e "$named_entry" ] && [ ! -L "$named_entry" ]; then
      continue
    fi
    named_basename="${named_entry##*/}"
    named_allowed="0"
    for named_expected in "$@"; do
      if [ "$named_basename" = "$named_expected" ]; then
        named_allowed="1"
        break
      fi
    done
    [ "$named_allowed" = "1" ] || return 1
  done
  return 0
}

write_lock_owner() {
  owner_tmp="$lock_path/.owner-pending-$$"
  owner_path="$lock_path/$LOCK_OWNER_NAME"
  [ ! -e "$owner_tmp" ] && [ ! -L "$owner_tmp" ] || return 1
  [ ! -e "$owner_path" ] && [ ! -L "$owner_path" ] || return 1

  {
    printf 'project=heyNag/codex-pet-grok-bot\n'
    printf 'pid=%s\n' "$$"
  } > "$owner_tmp" || return 1
  move_path "$owner_tmp" "$owner_path" || return 1
  owner_tmp=""
  load_lock_owner || return 1
  [ "$stale_owner_pid" = "$$" ]
}

load_process_owner_file() {
  process_owner_path="$1"
  [ -f "$process_owner_path" ] && [ ! -L "$process_owner_path" ] || return 1
  [ "$(wc -l < "$process_owner_path" | tr -d '[:space:]')" = "2" ] || return 1
  process_owner_project="$(receipt_value project "$process_owner_path")" || return 1
  process_owner_pid="$(receipt_value pid "$process_owner_path")" || return 1
  [ "$process_owner_project" = "heyNag/codex-pet-grok-bot" ] || return 1
  case "$process_owner_pid" in
    ""|*[!0123456789]*|????????????????????*) return 1 ;;
  esac
  [ "$process_owner_pid" -gt 1 ] 2>/dev/null || return 1
  return 0
}

load_lock_owner() {
  stale_owner_path="$lock_path/$LOCK_OWNER_NAME"
  load_process_owner_file "$stale_owner_path" || return 1
  stale_owner_pid="$process_owner_pid"
  return 0
}

receipt_matches_identity() {
  receipt_path="$1"
  expected_variant="$2"
  expected_id="$3"

  [ -f "$receipt_path" ] && [ ! -L "$receipt_path" ] || return 1
  [ "$(wc -l < "$receipt_path" | tr -d '[:space:]')" = "8" ] || return 1

  receipt_schema="$(receipt_value schema "$receipt_path")" || return 1
  receipt_project="$(receipt_value project "$receipt_path")" || return 1
  receipt_variant="$(receipt_value variant "$receipt_path")" || return 1
  receipt_id="$(receipt_value pet_id "$receipt_path")" || return 1
  receipt_release="$(receipt_value release "$receipt_path")" || return 1
  receipt_ref="$(receipt_value source_ref "$receipt_path")" || return 1
  receipt_manifest_sha="$(receipt_value pet_json_sha256 "$receipt_path")" || return 1
  receipt_sprite_sha="$(receipt_value spritesheet_sha256 "$receipt_path")" || return 1

  [ "$receipt_schema" = "1" ] || return 1
  [ "$receipt_project" = "heyNag/codex-pet-grok-bot" ] || return 1
  [ "$receipt_variant" = "$expected_variant" ] || return 1
  [ "$receipt_id" = "$expected_id" ] || return 1

  [ -n "$receipt_release" ] || return 1
  [ -n "$receipt_ref" ] || return 1
  case "$receipt_release$receipt_ref" in
    *[!0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._-]*) return 1 ;;
  esac
  is_sha256 "$receipt_manifest_sha" || return 1
  is_sha256 "$receipt_sprite_sha" || return 1
  return 0
}

manifest_declares_id() {
  manifest_path="$1"
  expected_manifest_id="$2"
  manifest_id_count="$(
    grep -Ec "^[[:space:]]*\"id\"[[:space:]]*:[[:space:]]*\"${expected_manifest_id}\"[[:space:]]*,?[[:space:]]*$" \
      "$manifest_path" 2>/dev/null || true
  )"
  [ "$manifest_id_count" = "1" ]
}

target_matches_hashes() {
  target_path="$1"
  expected_manifest_sha="$2"
  expected_sprite_sha="$3"

  [ -d "$target_path" ] && [ ! -L "$target_path" ] || return 1
  [ -f "$target_path/pet.json" ] && [ ! -L "$target_path/pet.json" ] || return 1
  [ -f "$target_path/spritesheet.webp" ] && [ ! -L "$target_path/spritesheet.webp" ] || return 1
  [ "$(hash_file "$target_path/pet.json")" = "$expected_manifest_sha" ] || return 1
  [ "$(hash_file "$target_path/spritesheet.webp")" = "$expected_sprite_sha" ] || return 1
  return 0
}

target_is_current() {
  target_matches_hashes "$1" "$2" "$3"
}

bundle_directory_has_only_expected_files() {
  exact_target="$1"
  exact_receipt_mode="$2"
  exact_entry_count="0"

  for exact_entry in "$exact_target"/* "$exact_target"/.[!.]* "$exact_target"/..?*; do
    if [ ! -e "$exact_entry" ] && [ ! -L "$exact_entry" ]; then
      continue
    fi

    case "$exact_entry" in
      "$exact_target/pet.json"|"$exact_target/spritesheet.webp")
        exact_entry_count=$((exact_entry_count + 1))
        ;;
      "$exact_target/$RECEIPT_NAME")
        [ "$exact_receipt_mode" = "with-receipt" ] || return 1
        exact_entry_count=$((exact_entry_count + 1))
        ;;
      *)
        return 1
        ;;
    esac
  done

  if [ "$exact_receipt_mode" = "with-receipt" ]; then
    [ "$exact_entry_count" -eq 3 ]
  else
    [ "$exact_entry_count" -eq 2 ]
  fi
}

target_is_unmodified_managed_copy() {
  managed_target="$1"
  managed_variant="$2"
  managed_id="$3"
  managed_receipt="$managed_target/$RECEIPT_NAME"

  receipt_matches_identity "$managed_receipt" "$managed_variant" "$managed_id" || return 1
  [ -f "$managed_target/pet.json" ] && [ ! -L "$managed_target/pet.json" ] || return 1
  [ -f "$managed_target/spritesheet.webp" ] && [ ! -L "$managed_target/spritesheet.webp" ] || return 1
  bundle_directory_has_only_expected_files "$managed_target" "with-receipt" || return 1
  manifest_declares_id "$managed_target/pet.json" "$managed_id" || return 1
  [ "$(hash_file "$managed_target/pet.json")" = "$receipt_manifest_sha" ] || return 1
  [ "$(hash_file "$managed_target/spritesheet.webp")" = "$receipt_sprite_sha" ] || return 1
  return 0
}

write_receipt() {
  receipt_destination="$1"
  receipt_variant="$2"
  receipt_id="$3"
  receipt_manifest="$4"
  receipt_sprite="$5"

  {
    printf 'schema=1\n'
    printf 'project=heyNag/codex-pet-grok-bot\n'
    printf 'variant=%s\n' "$receipt_variant"
    printf 'pet_id=%s\n' "$receipt_id"
    printf 'release=%s\n' "$RELEASE"
    printf 'source_ref=%s\n' "$SOURCE_REF"
    printf 'pet_json_sha256=%s\n' "$receipt_manifest"
    printf 'spritesheet_sha256=%s\n' "$receipt_sprite"
  } > "$receipt_destination"
}

inspect_variant() {
  inspect_variant_name="$1"
  set_variant_metadata "$inspect_variant_name"
  inspect_target="$pets_root/$meta_id"
  inspect_receipt="$inspect_target/$RECEIPT_NAME"
  inspected_state=""

  if [ -L "$inspect_target" ]; then
    fail "refusing to replace symlinked target: $inspect_target"
  fi

  if [ ! -e "$inspect_target" ]; then
    [ "$action" != "update" ] \
      || fail "$meta_name is not installed at $inspect_target"
    inspected_state="install"
    return
  fi

  [ -d "$inspect_target" ] \
    || fail "destination exists but is not a directory: $inspect_target"

  if target_is_current "$inspect_target" "$meta_manifest_sha" "$meta_sprite_sha"; then
    if [ ! -e "$inspect_receipt" ] && [ ! -L "$inspect_receipt" ]; then
      bundle_directory_has_only_expected_files "$inspect_target" "without-receipt" \
        || fail "$inspect_target contains files not owned by this installer; nothing was replaced"
      inspected_state="adopt"
      return
    fi

    target_is_unmodified_managed_copy "$inspect_target" "$inspect_variant_name" "$meta_id" \
      || fail "$inspect_target is not an exact unmodified installer-managed bundle; nothing was replaced"
    inspected_state="current"
    return
  fi

  target_is_unmodified_managed_copy "$inspect_target" "$inspect_variant_name" "$meta_id" \
    || fail "$inspect_target is unmanaged, locally modified, or contains unexpected files; nothing was replaced"
  inspected_state="update"
}

inspect_remove_variant() {
  inspect_variant_name="$1"
  set_variant_metadata "$inspect_variant_name"
  inspect_target="$pets_root/$meta_id"
  inspected_state=""

  if [ -L "$inspect_target" ]; then
    fail "refusing to remove symlinked target: $inspect_target"
  fi
  if [ ! -e "$inspect_target" ]; then
    inspected_state="absent"
    return
  fi
  [ -d "$inspect_target" ] || fail "destination exists but is not a directory: $inspect_target"
  target_is_unmodified_managed_copy "$inspect_target" "$inspect_variant_name" "$meta_id" || fail "$inspect_target is unmanaged, locally modified, or contains unexpected files; nothing was removed"
  inspected_state="remove"
}

state_for_variant() {
  case "$1" in
    dark) current_state="$dark_state" ;;
    light) current_state="$light_state" ;;
    *) fail "unsupported variant: $1" ;;
  esac
}

set_state_for_variant() {
  case "$1" in
    dark) dark_state="$2" ;;
    light) light_state="$2" ;;
    *) fail "unsupported variant: $1" ;;
  esac
}

set_result_for_variant() {
  case "$1" in
    dark) dark_result="$2" ;;
    light) light_result="$2" ;;
    *) fail "unsupported variant: $1" ;;
  esac
}

mark_applied() {
  case "$1" in
    dark)
      dark_applied="$2"
      dark_backup="$3"
      ;;
    light)
      light_applied="$2"
      light_backup="$3"
      ;;
    *)
      fail "unsupported variant: $1"
      ;;
  esac
}

set_planned_backup() {
  case "$1" in
    dark) dark_backup="$2" ;;
    light) light_backup="$2" ;;
    *) fail "unsupported variant: $1" ;;
  esac
}

planned_backup_for_variant() {
  case "$1" in
    dark) planned_backup="$dark_backup" ;;
    light) planned_backup="$light_backup" ;;
    *) planned_backup="" ;;
  esac
}

applied_for_variant() {
  case "$1" in
    dark)
      current_applied="$dark_applied"
      current_backup="$dark_backup"
      ;;
    light)
      current_applied="$light_applied"
      current_backup="$light_backup"
      ;;
    *)
      current_applied=""
      current_backup=""
      ;;
  esac
}

new_receipt_is_intact() {
  receipt_target="$1"
  receipt_variant="$2"
  receipt_id="$3"
  receipt_manifest="$4"
  receipt_sprite="$5"

  receipt_matches_identity "$receipt_target/$RECEIPT_NAME" "$receipt_variant" "$receipt_id" || return 1
  [ "$receipt_release" = "$RELEASE" ] || return 1
  [ "$receipt_ref" = "$SOURCE_REF" ] || return 1
  [ "$receipt_manifest_sha" = "$receipt_manifest" ] || return 1
  [ "$receipt_sprite_sha" = "$receipt_sprite" ] || return 1
  return 0
}

place_new_bundle() {
  placement_source="$1"
  placement_target="$2"
  placement_variant="$3"
  set_variant_metadata "$placement_variant"
  placement_source_name="$(basename "$placement_source")"

  move_path "$placement_source" "$placement_target" || return 1
  [ ! -e "$placement_source" ] && [ ! -L "$placement_source" ] || return 1

  placement_nested="$placement_target/$placement_source_name"
  if [ -d "$placement_nested" ] && [ ! -L "$placement_nested" ] \
    && target_is_current "$placement_nested" "$meta_manifest_sha" "$meta_sprite_sha" \
    && new_receipt_is_intact "$placement_nested" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha" \
    && bundle_directory_has_only_expected_files "$placement_nested" "with-receipt"; then
    move_path "$placement_nested" "$placement_source" || true
    return 1
  fi

  target_is_current "$placement_target" "$meta_manifest_sha" "$meta_sprite_sha" || return 1
  new_receipt_is_intact "$placement_target" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha" || return 1
  bundle_directory_has_only_expected_files "$placement_target" "with-receipt" || return 1
  return 0
}

restore_previous_bundle() {
  restore_source="$1"
  restore_target="$2"
  restore_variant="$3"
  set_variant_metadata "$restore_variant"
  restore_source_name="$(basename "$restore_source")"

  move_path "$restore_source" "$restore_target" || return 1
  [ ! -e "$restore_source" ] && [ ! -L "$restore_source" ] || return 1

  restore_nested="$restore_target/$restore_source_name"
  if [ -d "$restore_nested" ] && [ ! -L "$restore_nested" ] \
    && target_is_unmodified_managed_copy "$restore_nested" "$restore_variant" "$meta_id"; then
    move_path "$restore_nested" "$restore_source" || true
    return 1
  fi

  target_is_unmodified_managed_copy "$restore_target" "$restore_variant" "$meta_id"
}

preserve_previous_bundle() {
  preserve_source="$1"
  preserve_target="$2"
  preserve_variant="$3"
  set_variant_metadata "$preserve_variant"
  preserve_source_name="$(basename "$preserve_source")"

  target_is_unmodified_managed_copy "$preserve_source" "$preserve_variant" "$meta_id" || return 1
  move_path "$preserve_source" "$preserve_target" || return 1
  [ ! -e "$preserve_source" ] && [ ! -L "$preserve_source" ] || return 1

  preserve_nested="$preserve_target/$preserve_source_name"
  if [ -d "$preserve_nested" ] && [ ! -L "$preserve_nested" ] \
    && target_is_unmodified_managed_copy "$preserve_nested" "$preserve_variant" "$meta_id"; then
    restore_previous_bundle "$preserve_nested" "$preserve_source" "$preserve_variant" || true
    return 1
  fi

  target_is_unmodified_managed_copy "$preserve_target" "$preserve_variant" "$meta_id"
}

park_current_bundle_no_replace() {
  park_source="$1"
  park_target="$2"
  park_variant="$3"
  set_variant_metadata "$park_variant"
  park_source_name="$(basename "$park_source")"

  target_is_current "$park_source" "$meta_manifest_sha" "$meta_sprite_sha" \
    && new_receipt_is_intact "$park_source" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha" \
    || return 1
  move_path "$park_source" "$park_target" || return 1
  [ ! -e "$park_source" ] && [ ! -L "$park_source" ] || return 1

  park_nested="$park_target/$park_source_name"
  if [ -d "$park_nested" ] && [ ! -L "$park_nested" ] \
    && target_is_current "$park_nested" "$meta_manifest_sha" "$meta_sprite_sha" \
    && new_receipt_is_intact "$park_nested" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha"; then
    place_new_bundle "$park_nested" "$park_source" "$park_variant" || true
    return 1
  fi

  target_is_current "$park_target" "$meta_manifest_sha" "$meta_sprite_sha" \
    && new_receipt_is_intact "$park_target" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha"
}

park_recovery_bundle_no_replace() {
  park_recovery_source="$1"
  park_recovery_target="$2"
  park_recovery_variant="$3"
  park_recovery_manifest_sha="$4"
  park_recovery_sprite_sha="$5"
  set_variant_metadata "$park_recovery_variant"
  park_recovery_source_name="$(basename "$park_recovery_source")"

  recovery_target_is_new "$park_recovery_source" "$park_recovery_variant" "$park_recovery_manifest_sha" "$park_recovery_sprite_sha" || return 1
  move_path "$park_recovery_source" "$park_recovery_target" || return 1
  [ ! -e "$park_recovery_source" ] && [ ! -L "$park_recovery_source" ] || return 1

  park_recovery_nested="$park_recovery_target/$park_recovery_source_name"
  if [ -d "$park_recovery_nested" ] && [ ! -L "$park_recovery_nested" ] \
    && recovery_target_is_new "$park_recovery_nested" "$park_recovery_variant" "$park_recovery_manifest_sha" "$park_recovery_sprite_sha"; then
    move_path "$park_recovery_nested" "$park_recovery_source" || true
    return 1
  fi

  recovery_target_is_new "$park_recovery_target" "$park_recovery_variant" "$park_recovery_manifest_sha" "$park_recovery_sprite_sha"
}

park_receipt_no_replace() {
  park_receipt_source="$1"
  park_receipt_target="$2"
  [ -f "$park_receipt_source" ] && [ ! -L "$park_receipt_source" ] || return 1

  if [ -e "$park_receipt_target" ] || [ -L "$park_receipt_target" ]; then
    [ -f "$park_receipt_target" ] && [ ! -L "$park_receipt_target" ] || return 1
    [ "$(hash_file "$park_receipt_source")" = "$(hash_file "$park_receipt_target")" ] || return 1
  else
    link_file_no_replace "$park_receipt_source" "$park_receipt_target" || return 1
  fi
  rm -f "$park_receipt_source" || return 1
  [ ! -e "$park_receipt_source" ] && [ ! -L "$park_receipt_source" ]
}

safe_path_component() {
  safe_component="$1"
  case "$safe_component" in
    ""|.|..|*/*|*..*|*[!0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._-]*) return 1 ;;
    *) return 0 ;;
  esac
}

path_is_exact_child_with_prefix() {
  child_path="$1"
  child_parent="$2"
  child_prefix="$3"
  [ "$(dirname "$child_path")" = "$child_parent" ] || return 1
  child_basename="$(basename "$child_path")"
  safe_path_component "$child_basename" || return 1
  case "$child_basename" in
    "$child_prefix"?*) return 0 ;;
    *) return 1 ;;
  esac
}

owned_directory_transaction_token() {
  token_directory="$1"
  token_marker_name="$2"
  token_basename="$(basename "$token_directory")"
  case "$token_marker_name" in
    "$STAGE_MARKER_NAME")
      path_is_exact_child_with_prefix "$token_directory" "$codex_root" ".codex-pet-grok-bot.stage." || return 1
      marker_transaction_token="${token_basename#.codex-pet-grok-bot.stage.}"
      ;;
    "$BACKUP_MARKER_NAME")
      path_is_exact_child_with_prefix "$token_directory" "$backup_root" ".grok-bot-transaction-" || return 1
      marker_transaction_token="${token_basename#.grok-bot-transaction-}"
      ;;
    "$REMOVE_MARKER_NAME")
      path_is_exact_child_with_prefix "$token_directory" "$codex_root" ".codex-pet-grok-bot.remove." || return 1
      marker_transaction_token="${token_basename#.codex-pet-grok-bot.remove.}"
      ;;
    *) return 1 ;;
  esac
  safe_path_component "$marker_transaction_token"
}

write_owned_directory_marker() {
  marker_directory="$1"
  marker_name="$2"
  marker_path="$marker_directory/$marker_name"
  owned_directory_transaction_token "$marker_directory" "$marker_name" || return 1
  marker_pending="$marker_path.pending-$marker_transaction_token"
  [ ! -e "$marker_path" ] && [ ! -L "$marker_path" ] || return 1
  [ ! -e "$marker_pending" ] && [ ! -L "$marker_pending" ] || return 1
  {
    printf 'schema=1\n'
    printf 'project=heyNag/codex-pet-grok-bot\n'
    printf 'path=%s\n' "$marker_directory"
  } > "$marker_pending" || return 1
  move_path "$marker_pending" "$marker_path" || return 1
  owned_directory_marker_is_valid "$marker_directory" "$marker_name"
}

owned_directory_marker_is_valid() {
  marker_directory="$1"
  marker_name="$2"
  marker_path="$marker_directory/$marker_name"
  [ -f "$marker_path" ] && [ ! -L "$marker_path" ] || return 1
  [ "$(wc -l < "$marker_path" | tr -d '[:space:]')" = "3" ] || return 1
  marker_schema="$(receipt_value schema "$marker_path")" || return 1
  marker_project="$(receipt_value project "$marker_path")" || return 1
  marker_recorded_path="$(receipt_value path "$marker_path")" || return 1
  [ "$marker_schema" = "1" ] \
    && [ "$marker_project" = "heyNag/codex-pet-grok-bot" ] \
    && [ "$marker_recorded_path" = "$marker_directory" ]
}

prepare_recovery_owned_directory() {
  recovery_directory="$1"
  recovery_marker_name="$2"
  if [ -e "$recovery_directory" ] || [ -L "$recovery_directory" ]; then
    [ -d "$recovery_directory" ] && [ ! -L "$recovery_directory" ] || return 1
    if owned_directory_marker_is_valid "$recovery_directory" "$recovery_marker_name"; then
      return 0
    fi
    owned_directory_transaction_token "$recovery_directory" "$recovery_marker_name" || return 1
    recovery_marker_pending="$recovery_directory/$recovery_marker_name.pending-$marker_transaction_token"
    if [ -e "$recovery_marker_pending" ] || [ -L "$recovery_marker_pending" ]; then
      [ -f "$recovery_marker_pending" ] && [ ! -L "$recovery_marker_pending" ] || return 1
      directory_has_only_named_entries "$recovery_directory" "${recovery_marker_pending##*/}" || return 1
      rm -f "$recovery_marker_pending" || return 1
    fi
    directory_is_empty "$recovery_directory" || return 1
  else
    mkdir "$recovery_directory" || return 1
  fi
  write_owned_directory_marker "$recovery_directory" "$recovery_marker_name"
}

remove_owned_directory() {
  remove_directory="$1"
  remove_marker_name="$2"
  if [ ! -e "$remove_directory" ] && [ ! -L "$remove_directory" ]; then
    return 0
  fi
  [ -d "$remove_directory" ] && [ ! -L "$remove_directory" ] || return 1

  if ! owned_directory_marker_is_valid "$remove_directory" "$remove_marker_name"; then
    owned_directory_transaction_token "$remove_directory" "$remove_marker_name" || return 1
    remove_marker_pending="$remove_directory/$remove_marker_name.pending-$marker_transaction_token"
    if [ -e "$remove_marker_pending" ] || [ -L "$remove_marker_pending" ]; then
      [ -f "$remove_marker_pending" ] && [ ! -L "$remove_marker_pending" ] || return 1
      directory_has_only_named_entries "$remove_directory" "${remove_marker_pending##*/}" || return 1
      rm -f "$remove_marker_pending" || return 1
    fi
    directory_is_empty "$remove_directory" || return 1
    rmdir "$remove_directory"
    return
  fi

  for remove_entry in "$remove_directory"/* "$remove_directory"/.[!.]* "$remove_directory"/..?*; do
    if [ ! -e "$remove_entry" ] && [ ! -L "$remove_entry" ]; then
      continue
    fi
    [ "$remove_entry" = "$remove_directory/$remove_marker_name" ] && continue
    rm -rf "$remove_entry" || return 1
  done
  rm -f "$remove_directory/$remove_marker_name" || return 1
  rmdir "$remove_directory"
}

write_transaction_journal() {
  journal_phase="$1"
  case "$journal_phase" in
    prepared|committed) ;;
    *) return 1 ;;
  esac

  journal_dark_state="${dark_state:-none}"
  journal_light_state="${light_state:-none}"
  set_variant_metadata dark
  journal_dark_manifest_sha="$meta_manifest_sha"
  journal_dark_sprite_sha="$meta_sprite_sha"
  set_variant_metadata light
  journal_light_manifest_sha="$meta_manifest_sha"
  journal_light_sprite_sha="$meta_sprite_sha"
  journal_path="$lock_path/$JOURNAL_NAME"
  journal_tmp="$lock_path/.journal-pending-$$"
  [ ! -e "$journal_tmp" ] && [ ! -L "$journal_tmp" ] || return 1
  if [ -e "$journal_path" ] || [ -L "$journal_path" ]; then
    [ -f "$journal_path" ] && [ ! -L "$journal_path" ] || return 1
  fi

  {
    printf 'schema=1\n'
    printf 'project=heyNag/codex-pet-grok-bot\n'
    printf 'phase=%s\n' "$journal_phase"
    printf 'release=%s\n' "$RELEASE"
    printf 'source_ref=%s\n' "$SOURCE_REF"
    printf 'codex_root=%s\n' "$codex_root"
    printf 'stage_root=%s\n' "$stage_root"
    printf 'backup_run=%s\n' "$backup_run"
    printf 'dark_state=%s\n' "$journal_dark_state"
    printf 'dark_backup=%s\n' "$dark_backup"
    printf 'dark_manifest_sha256=%s\n' "$journal_dark_manifest_sha"
    printf 'dark_spritesheet_sha256=%s\n' "$journal_dark_sprite_sha"
    printf 'light_state=%s\n' "$journal_light_state"
    printf 'light_backup=%s\n' "$light_backup"
    printf 'light_manifest_sha256=%s\n' "$journal_light_manifest_sha"
    printf 'light_spritesheet_sha256=%s\n' "$journal_light_sprite_sha"
  } > "$journal_tmp" || return 1
  move_path "$journal_tmp" "$journal_path" || return 1
  journal_tmp=""
  load_transaction_journal || return 1
  [ "$recovery_phase" = "$journal_phase" ] || return 1
  durability_barrier || return 1
  return 0
}

validate_recovery_variant_fields() {
  recovery_field_variant="$1"
  recovery_field_state="$2"
  recovery_field_backup="$3"
  set_variant_metadata "$recovery_field_variant"

  case "$recovery_field_state" in
    none|current|adopt|install)
      [ -z "$recovery_field_backup" ] || return 1
      ;;
    update)
      [ -n "$recovery_backup_run" ] || return 1
      [ "$recovery_field_backup" = "$recovery_backup_run/.previous-$meta_id-$recovery_token" ] || return 1
      ;;
    *)
      return 1
      ;;
  esac
}

load_transaction_journal() {
  recovery_journal="$lock_path/$JOURNAL_NAME"
  [ -f "$recovery_journal" ] && [ ! -L "$recovery_journal" ] || return 1
  [ "$(wc -l < "$recovery_journal" | tr -d '[:space:]')" = "16" ] || return 1

  recovery_schema="$(receipt_value schema "$recovery_journal")" || return 1
  recovery_project="$(receipt_value project "$recovery_journal")" || return 1
  recovery_phase="$(receipt_value phase "$recovery_journal")" || return 1
  recovery_release="$(receipt_value release "$recovery_journal")" || return 1
  recovery_source_ref="$(receipt_value source_ref "$recovery_journal")" || return 1
  recovery_codex_root="$(receipt_value codex_root "$recovery_journal")" || return 1
  recovery_stage="$(receipt_value stage_root "$recovery_journal")" || return 1
  recovery_backup_run="$(receipt_value backup_run "$recovery_journal")" || return 1
  recovery_dark_state="$(receipt_value dark_state "$recovery_journal")" || return 1
  recovery_dark_backup="$(receipt_value dark_backup "$recovery_journal")" || return 1
  recovery_dark_manifest_sha="$(receipt_value dark_manifest_sha256 "$recovery_journal")" || return 1
  recovery_dark_sprite_sha="$(receipt_value dark_spritesheet_sha256 "$recovery_journal")" || return 1
  recovery_light_state="$(receipt_value light_state "$recovery_journal")" || return 1
  recovery_light_backup="$(receipt_value light_backup "$recovery_journal")" || return 1
  recovery_light_manifest_sha="$(receipt_value light_manifest_sha256 "$recovery_journal")" || return 1
  recovery_light_sprite_sha="$(receipt_value light_spritesheet_sha256 "$recovery_journal")" || return 1

  [ "$recovery_schema" = "1" ] || return 1
  [ "$recovery_project" = "heyNag/codex-pet-grok-bot" ] || return 1
  case "$recovery_phase" in prepared|committed) ;; *) return 1 ;; esac
  [ -n "$recovery_release" ] && [ -n "$recovery_source_ref" ] || return 1
  case "$recovery_release$recovery_source_ref" in
    *[!0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._-]*) return 1 ;;
  esac
  [ "$recovery_codex_root" = "$codex_root" ] || return 1
  path_is_exact_child_with_prefix "$recovery_stage" "$codex_root" ".codex-pet-grok-bot.stage." || return 1
  recovery_stage_basename="$(basename "$recovery_stage")"
  recovery_token="${recovery_stage_basename#.codex-pet-grok-bot.stage.}"
  safe_path_component "$recovery_token" || return 1
  case "$recovery_backup_run" in
    "") ;;
    *)
      [ "$recovery_backup_run" = "$backup_root/.grok-bot-transaction-$recovery_token" ] || return 1
      path_is_exact_child_with_prefix "$recovery_backup_run" "$backup_root" ".grok-bot-transaction-" || return 1
      ;;
  esac
  is_sha256 "$recovery_dark_manifest_sha" || return 1
  is_sha256 "$recovery_dark_sprite_sha" || return 1
  is_sha256 "$recovery_light_manifest_sha" || return 1
  is_sha256 "$recovery_light_sprite_sha" || return 1
  validate_recovery_variant_fields dark "$recovery_dark_state" "$recovery_dark_backup" || return 1
  validate_recovery_variant_fields light "$recovery_light_state" "$recovery_light_backup" || return 1

  if [ "$recovery_dark_state" = "update" ] || [ "$recovery_light_state" = "update" ]; then
    [ -n "$recovery_backup_run" ] || return 1
  else
    [ -z "$recovery_backup_run" ] || return 1
  fi
  return 0
}

recovery_target_is_new() {
  recovery_new_target="$1"
  recovery_new_variant="$2"
  recovery_new_manifest_sha="$3"
  recovery_new_sprite_sha="$4"
  set_variant_metadata "$recovery_new_variant"

  target_matches_hashes "$recovery_new_target" "$recovery_new_manifest_sha" "$recovery_new_sprite_sha" \
    && target_is_unmodified_managed_copy "$recovery_new_target" "$recovery_new_variant" "$meta_id" \
    && [ "$receipt_release" = "$recovery_release" ] \
    && [ "$receipt_ref" = "$recovery_source_ref" ] \
    && [ "$receipt_manifest_sha" = "$recovery_new_manifest_sha" ] \
    && [ "$receipt_sprite_sha" = "$recovery_new_sprite_sha" ]
}

recovery_prepared_variant_is_safe() {
  recovery_safe_variant="$1"
  recovery_safe_state="$2"
  recovery_safe_backup="$3"
  recovery_safe_manifest_sha="$4"
  recovery_safe_sprite_sha="$5"
  set_variant_metadata "$recovery_safe_variant"
  recovery_safe_target="$pets_root/$meta_id"
  recovery_safe_receipt="$recovery_safe_target/$RECEIPT_NAME"

  case "$recovery_safe_state" in
    none|current)
      return 0
      ;;
    install)
      if [ ! -e "$recovery_safe_target" ] && [ ! -L "$recovery_safe_target" ]; then
        return 0
      fi
      recovery_target_is_new "$recovery_safe_target" "$recovery_safe_variant" "$recovery_safe_manifest_sha" "$recovery_safe_sprite_sha"
      ;;
    adopt)
      [ -d "$recovery_safe_target" ] && [ ! -L "$recovery_safe_target" ] || return 1
      if [ ! -e "$recovery_safe_receipt" ] && [ ! -L "$recovery_safe_receipt" ]; then
        target_matches_hashes "$recovery_safe_target" "$recovery_safe_manifest_sha" "$recovery_safe_sprite_sha" \
          && bundle_directory_has_only_expected_files "$recovery_safe_target" "without-receipt"
      else
        recovery_target_is_new "$recovery_safe_target" "$recovery_safe_variant" "$recovery_safe_manifest_sha" "$recovery_safe_sprite_sha"
      fi
      ;;
    update)
      if [ -e "$recovery_safe_backup" ] || [ -L "$recovery_safe_backup" ]; then
        target_is_unmodified_managed_copy "$recovery_safe_backup" "$recovery_safe_variant" "$meta_id" || return 1
        if [ ! -e "$recovery_safe_target" ] && [ ! -L "$recovery_safe_target" ]; then
          return 0
        fi
        recovery_target_is_new "$recovery_safe_target" "$recovery_safe_variant" "$recovery_safe_manifest_sha" "$recovery_safe_sprite_sha"
      else
        target_is_unmodified_managed_copy "$recovery_safe_target" "$recovery_safe_variant" "$meta_id" || return 1
        if recovery_target_is_new "$recovery_safe_target" "$recovery_safe_variant" "$recovery_safe_manifest_sha" "$recovery_safe_sprite_sha"; then
          return 1
        fi
        return 0
      fi
      ;;
    *)
      return 1
      ;;
  esac
}

recovery_committed_variant_is_safe() {
  recovery_committed_variant="$1"
  recovery_committed_state="$2"
  recovery_committed_manifest_sha="$3"
  recovery_committed_sprite_sha="$4"
  set_variant_metadata "$recovery_committed_variant"
  recovery_committed_target="$pets_root/$meta_id"

  case "$recovery_committed_state" in
    none) return 0 ;;
    current)
      target_matches_hashes "$recovery_committed_target" "$recovery_committed_manifest_sha" "$recovery_committed_sprite_sha" \
        && target_is_unmodified_managed_copy "$recovery_committed_target" "$recovery_committed_variant" "$meta_id"
      ;;
    adopt|install|update)
      recovery_target_is_new "$recovery_committed_target" "$recovery_committed_variant" "$recovery_committed_manifest_sha" "$recovery_committed_sprite_sha"
      ;;
    *) return 1 ;;
  esac
}

recover_prepared_variant() {
  recover_variant_name="$1"
  recover_state="$2"
  recover_backup="$3"
  recover_manifest_sha="$4"
  recover_sprite_sha="$5"
  set_variant_metadata "$recover_variant_name"
  recover_target="$pets_root/$meta_id"
  recover_parked="$recovery_stage/.recovered-$meta_id-$stale_owner_pid"

  case "$recover_state" in
    none|current)
      return 0
      ;;
    install)
      if [ -e "$recover_target" ] || [ -L "$recover_target" ]; then
        park_recovery_bundle_no_replace \
          "$recover_target" "$recover_parked" "$recover_variant_name" \
          "$recover_manifest_sha" "$recover_sprite_sha" || return 1
      fi
      ;;
    adopt)
      if [ -e "$recover_target/$RECEIPT_NAME" ] || [ -L "$recover_target/$RECEIPT_NAME" ]; then
        park_receipt_no_replace "$recover_target/$RECEIPT_NAME" "$recover_parked.receipt" || return 1
      fi
      ;;
    update)
      if [ -e "$recover_backup" ] || [ -L "$recover_backup" ]; then
        if [ -e "$recover_target" ] || [ -L "$recover_target" ]; then
          park_recovery_bundle_no_replace \
            "$recover_target" "$recover_parked" "$recover_variant_name" \
            "$recover_manifest_sha" "$recover_sprite_sha" || return 1
        fi
        restore_previous_bundle "$recover_backup" "$recover_target" "$recover_variant_name" || return 1
      fi
      ;;
  esac
  return 0
}

recover_stale_transaction() {
  load_transaction_journal || return 1
  if [ -e "$recovery_stage" ] || [ -L "$recovery_stage" ]; then
    [ -d "$recovery_stage" ] && [ ! -L "$recovery_stage" ] || return 1
  fi
  if [ -n "$recovery_backup_run" ]; then
    if [ -e "$backup_root" ] || [ -L "$backup_root" ]; then
      [ -d "$backup_root" ] && [ ! -L "$backup_root" ] || return 1
    fi
    if [ -e "$recovery_backup_run" ] || [ -L "$recovery_backup_run" ]; then
      [ -d "$recovery_backup_run" ] && [ ! -L "$recovery_backup_run" ] || return 1
      prepare_recovery_owned_directory "$recovery_backup_run" "$BACKUP_MARKER_NAME" || return 1
    fi
  fi

  case "$recovery_phase" in
    prepared)
      recovery_prepared_variant_is_safe dark "$recovery_dark_state" "$recovery_dark_backup" "$recovery_dark_manifest_sha" "$recovery_dark_sprite_sha" || return 1
      recovery_prepared_variant_is_safe light "$recovery_light_state" "$recovery_light_backup" "$recovery_light_manifest_sha" "$recovery_light_sprite_sha" || return 1
      prepare_recovery_owned_directory "$recovery_stage" "$STAGE_MARKER_NAME" || return 1
      recover_prepared_variant light "$recovery_light_state" "$recovery_light_backup" "$recovery_light_manifest_sha" "$recovery_light_sprite_sha" || return 1
      recover_prepared_variant dark "$recovery_dark_state" "$recovery_dark_backup" "$recovery_dark_manifest_sha" "$recovery_dark_sprite_sha" || return 1
      durability_barrier || return 1
      ;;
    committed)
      recovery_committed_variant_is_safe dark "$recovery_dark_state" "$recovery_dark_manifest_sha" "$recovery_dark_sprite_sha" || return 1
      recovery_committed_variant_is_safe light "$recovery_light_state" "$recovery_light_manifest_sha" "$recovery_light_sprite_sha" || return 1
      ;;
    *) return 1 ;;
  esac

  if [ -n "$recovery_backup_run" ]; then
    remove_owned_directory "$recovery_backup_run" "$BACKUP_MARKER_NAME" || return 1
    rmdir "$backup_root" 2>/dev/null || true
  fi
  remove_owned_directory "$recovery_stage" "$STAGE_MARKER_NAME" || return 1
  durability_barrier || return 1
  rm -f "$recovery_journal" || return 1
  printf 'Recovered an interrupted Grok Bot installation safely.\n'
  return 0
}

rollback_variant() {
  rollback_variant_name="$1"
  applied_for_variant "$rollback_variant_name"
  [ -n "$current_applied" ] || return 0

  set_variant_metadata "$rollback_variant_name"
  rollback_target="$pets_root/$meta_id"

  case "$current_applied" in
    adopt)
      if [ ! -e "$rollback_target/$RECEIPT_NAME" ] && [ ! -L "$rollback_target/$RECEIPT_NAME" ]; then
        return 0
      elif new_receipt_is_intact "$rollback_target" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha"; then
        park_receipt_no_replace "$rollback_target/$RECEIPT_NAME" "$stage_root/.rollback-$meta_id-receipt" \
          || rollback_failed="1"
      else
        printf 'Grok Bot installer: could not safely roll back receipt at %s\n' "$rollback_target" >&2
        rollback_failed="1"
      fi
      ;;
    install)
      if [ -e "$rollback_target" ] || [ -L "$rollback_target" ]; then
        if target_is_current "$rollback_target" "$meta_manifest_sha" "$meta_sprite_sha" \
          && new_receipt_is_intact "$rollback_target" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha"; then
          park_current_bundle_no_replace "$rollback_target" "$stage_root/.rollback-$meta_id" "$rollback_variant_name" \
            || rollback_failed="1"
        elif [ -d "$stage_root/.new-$meta_id-${stage_root##*.}" ] \
          && target_is_current "$stage_root/.new-$meta_id-${stage_root##*.}" "$meta_manifest_sha" "$meta_sprite_sha" \
          && new_receipt_is_intact "$stage_root/.new-$meta_id-${stage_root##*.}" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha"; then
          # Placement lost a destination race and put our staged bundle back.
          # The unexpected target is not ours, so leave it untouched.
          return 0
        else
          printf 'Grok Bot installer: could not safely move changed rollback target %s\n' "$rollback_target" >&2
          rollback_failed="1"
        fi
      fi

      ;;
    update)
      if [ ! -e "$current_backup" ] && [ ! -L "$current_backup" ]; then
        return 0
      fi
      if ! target_is_unmodified_managed_copy "$current_backup" "$rollback_variant_name" "$meta_id"; then
        printf 'Grok Bot installer: refusing an invalid rollback backup at %s\n' "$current_backup" >&2
        rollback_failed="1"
        return 0
      fi

      if [ -e "$rollback_target" ] || [ -L "$rollback_target" ]; then
        if target_is_current "$rollback_target" "$meta_manifest_sha" "$meta_sprite_sha" \
          && new_receipt_is_intact "$rollback_target" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha"; then
          park_current_bundle_no_replace "$rollback_target" "$stage_root/.rollback-$meta_id" "$rollback_variant_name" \
            || rollback_failed="1"
        else
          printf 'Grok Bot installer: could not safely move changed rollback target %s\n' "$rollback_target" >&2
          rollback_failed="1"
        fi
      fi

      if [ ! -e "$rollback_target" ] && [ ! -L "$rollback_target" ]; then
        restore_previous_bundle "$current_backup" "$rollback_target" "$rollback_variant_name" \
          || rollback_failed="1"
      else
        printf 'Grok Bot installer: previous version remains at %s\n' "$current_backup" >&2
        rollback_failed="1"
      fi
      ;;
    remove)
      if [ ! -e "$current_backup" ] && [ ! -L "$current_backup" ]; then
        return 0
      fi
      if ! target_is_unmodified_managed_copy "$current_backup" "$rollback_variant_name" "$meta_id"; then
        printf 'Grok Bot installer: refusing an invalid removal quarantine at %s\n' "$current_backup" >&2
        rollback_failed="1"
        return 0
      fi
      if [ -e "$rollback_target" ] || [ -L "$rollback_target" ]; then
        printf 'Grok Bot installer: could not restore removed pet because its active path is occupied: %s\n' "$rollback_target" >&2
        rollback_failed="1"
        return 0
      fi
      restore_previous_bundle "$current_backup" "$rollback_target" "$rollback_variant_name" || rollback_failed="1"
      ;;
  esac
}

rollback_transaction() {
  rollback_failed="0"
  rollback_variant light
  rollback_variant dark

  if [ "$rollback_failed" = "1" ]; then
    if [ "$action" = "remove" ]; then
      printf 'Grok Bot installer: automatic removal rollback was incomplete; the quarantine was preserved\n' >&2
    else
      printf 'Grok Bot installer: automatic rollback was incomplete; preserved backups were not deleted\n' >&2
    fi
  fi
}

cleanup_stage() {
  [ -n "$stage_root" ] || return 0
  [ "$stage_owned" = "1" ] || return 0
  path_is_exact_child_with_prefix "$stage_root" "$codex_root" ".codex-pet-grok-bot.stage." \
    || return 1
  remove_owned_directory "$stage_root" "$STAGE_MARKER_NAME" || return 1
  stage_root=""
  stage_owned="0"
  return 0
}

release_lock() {
  [ "$lock_owned" = "1" ] || return 0
  if [ -n "$journal_tmp" ] && { [ -e "$journal_tmp" ] || [ -L "$journal_tmp" ]; }; then
    [ "$journal_tmp" = "$lock_path/.journal-pending-$$" ] \
      && [ -f "$journal_tmp" ] && [ ! -L "$journal_tmp" ] || return 1
    rm -f "$journal_tmp" || return 1
    journal_tmp=""
  fi
  if [ -n "$owner_tmp" ] && { [ -e "$owner_tmp" ] || [ -L "$owner_tmp" ]; }; then
    [ "$owner_tmp" = "$lock_path/.owner-pending-$$" ] \
      && [ -f "$owner_tmp" ] && [ ! -L "$owner_tmp" ] || return 1
    rm -f "$owner_tmp" || return 1
    owner_tmp=""
  fi
  lock_journal="$lock_path/$JOURNAL_NAME"
  if [ -e "$lock_journal" ] || [ -L "$lock_journal" ]; then
    if [ -f "$lock_journal" ] && [ ! -L "$lock_journal" ]; then
      rm -f "$lock_journal" || return 1
    else
      printf 'Grok Bot installer: refusing unexpected lock journal at %s\n' "$lock_journal" >&2
      return 1
    fi
  fi
  lock_owner="$lock_path/$LOCK_OWNER_NAME"
  if [ -e "$lock_owner" ] || [ -L "$lock_owner" ]; then
    load_process_owner_file "$lock_owner" || return 1
    [ "$process_owner_pid" = "$$" ] || return 1
    directory_has_only_named_entries "$lock_path" "$LOCK_OWNER_NAME" || return 1
    rm -f "$lock_owner" || return 1
  else
    directory_is_empty "$lock_path" || return 1
  fi
  rmdir "$lock_path" || return 1
  lock_owned="0"
  return 0
}

cleanup_backup() {
  [ -n "$backup_run" ] || return 0
  [ "$backup_owned" = "1" ] || return 0
  path_is_exact_child_with_prefix "$backup_run" "$backup_root" ".grok-bot-transaction-" \
    || return 1
  remove_owned_directory "$backup_run" "$BACKUP_MARKER_NAME" || return 1
  backup_run=""
  backup_owned="0"
  rmdir "$backup_root" 2>/dev/null || true
  return 0
}

remove_quarantined_variant() {
  remove_variant_name="$1"
  set_variant_metadata "$remove_variant_name"
  remove_quarantined="$remove_root/$meta_id"
  if [ ! -e "$remove_quarantined" ] && [ ! -L "$remove_quarantined" ]; then
    return 0
  fi
  [ "$(dirname "$remove_quarantined")" = "$remove_root" ] || return 1
  [ "$(basename "$remove_quarantined")" = "$meta_id" ] || return 1
  target_is_unmodified_managed_copy "$remove_quarantined" "$remove_variant_name" "$meta_id" || return 1
  rm -f "$remove_quarantined/spritesheet.webp" || return 1
  rm -f "$remove_quarantined/pet.json" || return 1
  rm -f "$remove_quarantined/$RECEIPT_NAME" || return 1
  rmdir "$remove_quarantined"
}

cleanup_remove_root() {
  [ -n "$remove_root" ] || return 0
  [ "$remove_owned" = "1" ] || return 0
  path_is_exact_child_with_prefix "$remove_root" "$codex_root" ".codex-pet-grok-bot.remove." || return 1
  owned_directory_marker_is_valid "$remove_root" "$REMOVE_MARKER_NAME" || return 1
  directory_has_only_named_entries "$remove_root" "$REMOVE_MARKER_NAME" "grok-bot-dark" "grok-bot-light" || return 1

  for remove_variant_name in dark light; do
    set_variant_metadata "$remove_variant_name"
    remove_quarantined="$remove_root/$meta_id"
    if [ -e "$remove_quarantined" ] || [ -L "$remove_quarantined" ]; then
      target_is_unmodified_managed_copy "$remove_quarantined" "$remove_variant_name" "$meta_id" || return 1
    fi
  done
  remove_quarantined_variant dark || return 1
  remove_quarantined_variant light || return 1
  rm -f "$remove_root/$REMOVE_MARKER_NAME" || return 1
  rmdir "$remove_root" || return 1
  remove_root=""
  remove_owned="0"
  return 0
}

on_exit() {
  exit_status="$?"
  trap - EXIT HUP INT TERM
  set +e
  preserve_transaction="0"

  if [ "$transaction_active" = "1" ]; then
    if [ "$commit_publication_started" = "1" ]; then
      preserve_transaction="1"
    else
      rollback_transaction
      [ "$rollback_failed" = "0" ] || preserve_transaction="1"
      if [ "$preserve_transaction" = "0" ]; then
        durability_barrier || preserve_transaction="1"
      fi
    fi
  fi
  if [ "$preserve_transaction" = "0" ]; then
    cleanup_stage || preserve_transaction="1"
    cleanup_backup || preserve_transaction="1"
    cleanup_remove_root || preserve_transaction="1"
    if [ "$preserve_transaction" = "0" ] \
      && [ "$lock_owned" = "1" ] \
      && [ -f "$lock_path/$JOURNAL_NAME" ]; then
      durability_barrier || preserve_transaction="1"
    fi
  fi
  if [ "$preserve_transaction" = "1" ]; then
    if [ "$action" = "remove" ]; then
      printf 'Grok Bot installer: preserved removal quarantine for inspection at %s\n' "$remove_root" >&2
    else
      printf 'Grok Bot installer: preserved transaction state for automatic recovery on the next run\n' >&2
    fi
    exit_status="1"
  elif ! release_lock; then
    printf 'Grok Bot installer: could not remove its lock cleanly at %s\n' "$lock_path" >&2
    exit_status="1"
  fi
  if [ "$recovery_claim_owned" = "1" ]; then
    if ! release_recovery_claim; then
      printf 'Grok Bot installer: recovery claim remains at %s/%s\n' "$lock_path" "$RECOVERY_CLAIM_NAME" >&2
      exit_status="1"
    fi
  fi
  exit "$exit_status"
}

trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

apply_remove_variant() {
  apply_variant_name="$1"
  state_for_variant "$apply_variant_name"
  set_variant_metadata "$apply_variant_name"
  apply_target="$pets_root/$meta_id"

  if [ "$current_state" = "absent" ]; then
    set_result_for_variant "$apply_variant_name" "absent"
    return 0
  fi
  [ "$current_state" = "remove" ] || fail "unexpected removal state for $apply_variant_name"
  apply_quarantine="$remove_root/$meta_id"
  [ ! -e "$apply_quarantine" ] && [ ! -L "$apply_quarantine" ] || fail "removal quarantine already exists: $apply_quarantine"
  mark_applied "$apply_variant_name" "remove" "$apply_quarantine"
  preserve_previous_bundle "$apply_target" "$apply_quarantine" "$apply_variant_name" || fail "could not quarantine $meta_name for removal"
  set_result_for_variant "$apply_variant_name" "removed"
}

print_remove_result() {
  result_variant="$1"
  set_variant_metadata "$result_variant"
  case "$result_variant" in
    dark) result_value="$dark_result" ;;
    light) result_value="$light_result" ;;
  esac
  case "$result_value" in
    removed) printf 'Removed %s from %s\n' "$meta_name" "$pets_root/$meta_id" ;;
    absent) printf '%s is already absent from %s\n' "$meta_name" "$pets_root/$meta_id" ;;
  esac
}

stage_variant() {
  stage_variant_name="$1"
  state_for_variant "$stage_variant_name"
  set_variant_metadata "$stage_variant_name"

  [ "$current_state" != "current" ] || return 0

  if [ "$current_state" = "adopt" ]; then
    write_receipt \
      "$stage_root/$meta_id.receipt" \
      "$meta_variant" \
      "$meta_id" \
      "$meta_manifest_sha" \
      "$meta_sprite_sha"
    return 0
  fi

  staged_bundle="$stage_root/.new-$meta_id-${stage_root##*.}"
  mkdir "$staged_bundle"
  download_file "$source_base/pet/$meta_id/pet.json" "$staged_bundle/pet.json"
  download_file "$source_base/pet/$meta_id/spritesheet.webp" "$staged_bundle/spritesheet.webp"
  verify_file "$staged_bundle/pet.json" "$meta_manifest_size" "$meta_manifest_sha"
  verify_file "$staged_bundle/spritesheet.webp" "$meta_sprite_size" "$meta_sprite_sha"
  write_receipt \
    "$staged_bundle/$RECEIPT_NAME" \
    "$meta_variant" \
    "$meta_id" \
    "$meta_manifest_sha" \
    "$meta_sprite_sha"
}

apply_variant() {
  apply_variant_name="$1"
  state_for_variant "$apply_variant_name"
  set_variant_metadata "$apply_variant_name"
  apply_target="$pets_root/$meta_id"

  case "$current_state" in
    current)
      set_result_for_variant "$apply_variant_name" "current"
      return 0
      ;;
    adopt)
      [ ! -e "$apply_target/$RECEIPT_NAME" ] && [ ! -L "$apply_target/$RECEIPT_NAME" ] \
        || fail "receipt appeared during installation: $apply_target/$RECEIPT_NAME"
      mark_applied "$apply_variant_name" "adopt" ""
      link_file_no_replace "$stage_root/$meta_id.receipt" "$apply_target/$RECEIPT_NAME" \
        || fail "could not register the existing $meta_name installation"
      new_receipt_is_intact "$apply_target" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha" \
        || fail "could not verify the registered $meta_name installation"
      set_result_for_variant "$apply_variant_name" "adopted"
      ;;
    install)
      [ ! -e "$apply_target" ] && [ ! -L "$apply_target" ] \
        || fail "$apply_target appeared during installation; nothing was replaced"
      mark_applied "$apply_variant_name" "install" ""
      apply_source="$stage_root/.new-$meta_id-${stage_root##*.}"
      place_new_bundle "$apply_source" "$apply_target" "$apply_variant_name" \
        || fail "could not install $meta_name without replacing an unexpected destination"
      set_result_for_variant "$apply_variant_name" "installed"
      ;;
    update)
      target_is_unmodified_managed_copy "$apply_target" "$apply_variant_name" "$meta_id" \
        || fail "$apply_target changed during installation; nothing was replaced"
      planned_backup_for_variant "$apply_variant_name"
      apply_backup="$planned_backup"
      [ -n "$apply_backup" ] || fail "no rollback path was planned for $meta_name"
      [ ! -e "$apply_backup" ] && [ ! -L "$apply_backup" ] \
        || fail "backup path already exists: $apply_backup"
      mark_applied "$apply_variant_name" "update" "$apply_backup"
      preserve_previous_bundle "$apply_target" "$apply_backup" "$apply_variant_name" \
        || fail "could not preserve the previous $meta_name installation"
      [ ! -e "$apply_target" ] && [ ! -L "$apply_target" ] \
        || fail "$apply_target appeared during update"
      apply_source="$stage_root/.new-$meta_id-${stage_root##*.}"
      place_new_bundle "$apply_source" "$apply_target" "$apply_variant_name" \
        || fail "could not place the updated $meta_name installation"
      set_result_for_variant "$apply_variant_name" "updated"
      ;;
    *)
      fail "unexpected installation state for $apply_variant_name"
      ;;
  esac
}

print_result() {
  result_variant="$1"
  set_variant_metadata "$result_variant"
  case "$result_variant" in
    dark) result_value="$dark_result" ;;
    light) result_value="$light_result" ;;
  esac

  case "$result_value" in
    current)
      printf '%s is already up to date at %s\n' "$meta_name" "$pets_root/$meta_id"
      ;;
    adopted)
      printf 'Registered the existing current %s installation at %s\n' "$meta_name" "$pets_root/$meta_id"
      ;;
    installed)
      printf 'Installed %s at %s\n' "$meta_name" "$pets_root/$meta_id"
      ;;
    updated)
      printf 'Updated %s at %s\n' "$meta_name" "$pets_root/$meta_id"
      ;;
  esac
}

verify_active_variant() {
  verified_variant="$1"
  set_variant_metadata "$verified_variant"
  verified_target="$pets_root/$meta_id"

  target_is_current "$verified_target" "$meta_manifest_sha" "$meta_sprite_sha" \
    && new_receipt_is_intact "$verified_target" "$meta_variant" "$meta_id" "$meta_manifest_sha" "$meta_sprite_sha" \
    && bundle_directory_has_only_expected_files "$verified_target" "with-receipt"
}

find_pending_owner() {
  pending_directory="$1"
  pending_found=""
  pending_pid=""

  for pending_entry in "$pending_directory"/.owner-pending-*; do
    if [ ! -e "$pending_entry" ] && [ ! -L "$pending_entry" ]; then
      continue
    fi
    [ -z "$pending_found" ] || return 1
    [ -f "$pending_entry" ] && [ ! -L "$pending_entry" ] || return 1
    pending_basename="${pending_entry##*/}"
    pending_candidate_pid="${pending_basename#.owner-pending-}"
    case "$pending_candidate_pid" in
      ""|*[!0123456789]*|????????????????????*) return 1 ;;
    esac
    [ "$pending_candidate_pid" -gt 1 ] 2>/dev/null || return 1
    pending_found="$pending_entry"
    pending_pid="$pending_candidate_pid"
  done
  [ -n "$pending_found" ]
}

write_recovery_claim_owner() {
  claim_directory="$lock_path/$RECOVERY_CLAIM_NAME"
  claim_pending="$claim_directory/.owner-pending-$$"
  claim_owner="$claim_directory/$LOCK_OWNER_NAME"
  {
    printf 'project=heyNag/codex-pet-grok-bot\n'
    printf 'pid=%s\n' "$$"
  } > "$claim_pending" || return 1
  move_path "$claim_pending" "$claim_owner" || return 1
  load_process_owner_file "$claim_owner" || return 1
  [ "$process_owner_pid" = "$$" ]
}

acquire_recovery_claim() {
  claim_directory="$lock_path/$RECOVERY_CLAIM_NAME"
  claim_attempts="0"

  while [ "$claim_attempts" -lt 4 ]; do
    claim_attempts=$((claim_attempts + 1))
    if mkdir "$claim_directory" 2>/dev/null; then
      recovery_claim_owned="1"
      write_recovery_claim_owner || return 1
      return 0
    fi

    [ -d "$claim_directory" ] && [ ! -L "$claim_directory" ] || return 1
    claim_owner="$claim_directory/$LOCK_OWNER_NAME"
    if load_process_owner_file "$claim_owner"; then
      claim_existing_pid="$process_owner_pid"
      process_is_alive "$claim_existing_pid" && return 1
      directory_has_only_named_entries "$claim_directory" "$LOCK_OWNER_NAME" || return 1
      rm -f "$claim_owner" || return 1
      rmdir "$claim_directory" 2>/dev/null || continue
      continue
    fi

    if directory_is_empty "$claim_directory"; then
      rmdir "$claim_directory" 2>/dev/null || continue
      continue
    fi
    find_pending_owner "$claim_directory" || return 1
    process_is_alive "$pending_pid" && return 1
    directory_has_only_named_entries "$claim_directory" "${pending_found##*/}" || return 1
    rm -f "$pending_found" || return 1
    rmdir "$claim_directory" 2>/dev/null || continue
  done
  return 1
}

release_recovery_claim() {
  [ "$recovery_claim_owned" = "1" ] || return 0
  claim_directory="$lock_path/$RECOVERY_CLAIM_NAME"
  claim_owner="$claim_directory/$LOCK_OWNER_NAME"
  load_process_owner_file "$claim_owner" || return 1
  [ "$process_owner_pid" = "$$" ] || return 1
  directory_has_only_named_entries "$claim_directory" "$LOCK_OWNER_NAME" || return 1
  rm -f "$claim_owner" || return 1
  rmdir "$claim_directory" || return 1
  recovery_claim_owned="0"
  return 0
}

remove_dead_journal_pending() {
  dead_pending="$lock_path/.journal-pending-$stale_owner_pid"
  if [ ! -e "$dead_pending" ] && [ ! -L "$dead_pending" ]; then
    return 0
  fi
  [ -f "$dead_pending" ] && [ ! -L "$dead_pending" ] || return 1
  rm -f "$dead_pending"
}

finish_stale_lock_cleanup() {
  stale_owner="$lock_path/$LOCK_OWNER_NAME"
  load_lock_owner || return 1
  [ "$stale_owner_pid" = "$recovered_owner_pid" ] || return 1
  rm -f "$stale_owner" || return 1
  release_recovery_claim || return 1
  rmdir "$lock_path" || return 1
  return 0
}

cleanup_ownerless_recovery_claim() {
  orphan_claim_directory="$lock_path/$RECOVERY_CLAIM_NAME"
  [ -d "$orphan_claim_directory" ] && [ ! -L "$orphan_claim_directory" ] || return 1
  directory_has_only_named_entries "$lock_path" "$RECOVERY_CLAIM_NAME" || return 1
  orphan_claim_owner="$orphan_claim_directory/$LOCK_OWNER_NAME"

  if load_process_owner_file "$orphan_claim_owner"; then
    orphan_claim_pid="$process_owner_pid"
    process_is_alive "$orphan_claim_pid" && return 1
    directory_has_only_named_entries "$orphan_claim_directory" "$LOCK_OWNER_NAME" || return 1
    rm -f "$orphan_claim_owner" || return 1
  elif directory_is_empty "$orphan_claim_directory"; then
    :
  elif find_pending_owner "$orphan_claim_directory"; then
    process_is_alive "$pending_pid" && return 1
    directory_has_only_named_entries "$orphan_claim_directory" "${pending_found##*/}" || return 1
    rm -f "$pending_found" || return 1
  else
    return 1
  fi

  rmdir "$orphan_claim_directory" || return 1
  rmdir "$lock_path" || return 1
  return 0
}

recover_existing_lock() {
  [ -d "$lock_path" ] && [ ! -L "$lock_path" ] || return 1

  if ! load_lock_owner; then
    if directory_is_empty "$lock_path"; then
      rmdir "$lock_path" 2>/dev/null || return 1
      return 0
    fi
    if find_pending_owner "$lock_path"; then
      process_is_alive "$pending_pid" && return 1
      directory_has_only_named_entries "$lock_path" "${pending_found##*/}" || return 1
      rm -f "$pending_found" || return 1
      rmdir "$lock_path" || return 1
      return 0
    fi
    if [ -e "$lock_path/$RECOVERY_CLAIM_NAME" ] || [ -L "$lock_path/$RECOVERY_CLAIM_NAME" ]; then
      cleanup_ownerless_recovery_claim
      return
    fi
    return 1
  fi

  recovered_owner_pid="$stale_owner_pid"
  process_is_alive "$recovered_owner_pid" && return 1
  acquire_recovery_claim || return 1
  load_lock_owner || return 1
  [ "$stale_owner_pid" = "$recovered_owner_pid" ] || return 1
  process_is_alive "$recovered_owner_pid" && return 1
  remove_dead_journal_pending || return 1

  stale_journal="$lock_path/$JOURNAL_NAME"
  if [ -e "$stale_journal" ] || [ -L "$stale_journal" ]; then
    directory_has_only_named_entries \
      "$lock_path" "$LOCK_OWNER_NAME" "$JOURNAL_NAME" "$RECOVERY_CLAIM_NAME" || return 1
    recover_stale_transaction || return 1
  else
    directory_has_only_named_entries \
      "$lock_path" "$LOCK_OWNER_NAME" "$RECOVERY_CLAIM_NAME" || return 1
  fi
  finish_stale_lock_cleanup
}

acquire_install_lock() {
  if [ -e "$lock_path" ] || [ -L "$lock_path" ]; then
    recover_existing_lock \
      || fail "another Grok Bot installation may be running, or its lock needs inspection: $lock_path"
  fi

  if mkdir "$lock_path" 2>/dev/null; then
    lock_owned="1"
    write_lock_owner || fail "could not record installer ownership in $lock_path"
  else
    fail "another Grok Bot installation may be running; lock exists at $lock_path"
  fi
}

main() {
  case "${1:-}" in
    -h|--help|help)
      [ "$#" -eq 1 ] || fail "help does not accept extra arguments"
      usage
      return 0
      ;;
    update)
      [ "$#" -eq 2 ] || {
        usage >&2
        fail "update requires exactly one of: dark, light, both"
      }
      action="update"
      selection="$2"
      ;;
    remove)
      [ "$#" -eq 2 ] || {
        usage >&2
        fail "remove requires exactly one of: dark, light, both"
      }
      action="remove"
      selection="$2"
      ;;
    dark|light|both)
      [ "$#" -eq 1 ] || {
        usage >&2
        fail "unexpected extra argument"
      }
      selection="$1"
      ;;
    "")
      usage >&2
      return 2
      ;;
    *)
      usage >&2
      fail "unknown command or variant: $1"
      ;;
  esac

  case "$selection" in
    dark) variants="dark" ;;
    light) variants="light" ;;
    both) variants="dark light" ;;
    *)
      usage >&2
      fail "choose dark, light, or both"
      ;;
  esac

  if [ "$action" != "remove" ]; then
    command -v curl >/dev/null 2>&1 || fail "curl is required"
  fi
  command -v sync >/dev/null 2>&1 || fail "sync is required for crash-safe installation"
  if command -v sha256sum >/dev/null 2>&1; then
    hash_tool="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    hash_tool="shasum"
  elif command -v openssl >/dev/null 2>&1; then
    hash_tool="openssl"
  else
    fail "sha256sum, shasum, or openssl is required"
  fi

  if [ -n "${CODEX_HOME:-}" ]; then
    codex_root="$CODEX_HOME"
  elif [ -n "${HOME:-}" ]; then
    codex_root="$HOME/.codex"
  else
    fail "HOME is not set; set CODEX_HOME to an absolute directory"
  fi

  case "$codex_root" in
    /*) ;;
    *) fail "CODEX_HOME must be an absolute path" ;;
  esac
  [ "$codex_root" != "/" ] || fail "CODEX_HOME cannot be the filesystem root"
  case "$codex_root" in
    *'
'*) fail "CODEX_HOME cannot contain a newline" ;;
  esac
  if [ -e "$codex_root" ] || [ -L "$codex_root" ]; then
    [ -d "$codex_root" ] || fail "CODEX_HOME is not a directory: $codex_root"
  else
    mkdir -p "$codex_root" || fail "could not create CODEX_HOME: $codex_root"
  fi
  resolved_codex_root="$(CDPATH='' cd "$codex_root" 2>/dev/null && pwd -P)" \
    || fail "could not resolve CODEX_HOME: $codex_root"
  codex_root="$resolved_codex_root"
  [ "$codex_root" != "/" ] || fail "CODEX_HOME cannot resolve to the filesystem root"

  pets_root="$codex_root/pets"
  backup_root="$codex_root/pet-backups"
  lock_path="$codex_root/.codex-pet-grok-bot.lock"
  if [ "$action" != "remove" ]; then
    source_base="${GROK_BOT_INSTALL_SOURCE_BASE:-$DEFAULT_SOURCE_BASE}"
    source_base="${source_base%/}"

    case "$source_base" in
      https://*|file://*) ;;
      *) fail "installer source must use https:// or file://" ;;
    esac
  fi

  [ ! -L "$pets_root" ] || fail "refusing to use a symlinked pets directory: $pets_root"
  mkdir -p "$pets_root" || fail "could not create pets directory: $pets_root"
  [ -d "$pets_root" ] && [ ! -L "$pets_root" ] \
    || fail "pets path is not a regular directory: $pets_root"

  acquire_install_lock

  if [ "$action" = "remove" ]; then
    needs_remove="0"
    for variant in $variants; do
      inspect_remove_variant "$variant"
      set_state_for_variant "$variant" "$inspected_state"
      [ "$inspected_state" = "remove" ] && needs_remove="1"
    done

    if [ "$needs_remove" = "1" ]; then
      transaction_base="$(date -u +%Y%m%dT%H%M%SZ)-$$"
      transaction_token="$transaction_base"
      transaction_suffix="0"
      while :; do
        remove_root="$codex_root/.codex-pet-grok-bot.remove.$transaction_token"
        if [ ! -e "$remove_root" ] && [ ! -L "$remove_root" ]; then
          break
        fi
        transaction_suffix=$((transaction_suffix + 1))
        transaction_token="$transaction_base-$transaction_suffix"
      done
      mkdir "$remove_root" || fail "could not create removal quarantine: $remove_root"
      remove_owned="1"
      write_owned_directory_marker "$remove_root" "$REMOVE_MARKER_NAME" || fail "could not mark removal quarantine ownership"
      durability_barrier || fail "could not make removal quarantine durable"
      transaction_active="1"
    fi

    for variant in $variants; do
      apply_remove_variant "$variant"
    done
    if [ "$needs_remove" = "1" ]; then
      durability_barrier || fail "could not make removal renames durable"
      transaction_active="0"
      cleanup_remove_root || fail "could not clean the verified removal quarantine safely"
      durability_barrier || fail "could not make removal cleanup durable"
    fi
    release_lock || fail "could not remove the installer lock cleanly"
    for variant in $variants; do
      print_remove_result "$variant"
    done
    printf '\nDone. Open Settings > Pets and select Refresh.\n'
    return 0
  fi

  for variant in $variants; do
    inspect_variant "$variant"
    set_state_for_variant "$variant" "$inspected_state"
  done

  needs_stage="0"
  needs_backup="0"
  for variant in $variants; do
    state_for_variant "$variant"
    [ "$current_state" = "current" ] || needs_stage="1"
    [ "$current_state" = "update" ] && needs_backup="1"
  done

  if [ "$needs_stage" = "1" ]; then
    transaction_base="$(date -u +%Y%m%dT%H%M%SZ)-$$"
    transaction_token="$transaction_base"
    transaction_suffix="0"
    while :; do
      stage_root="$codex_root/.codex-pet-grok-bot.stage.$transaction_token"
      if [ "$needs_backup" = "1" ]; then
        backup_run="$backup_root/.grok-bot-transaction-$transaction_token"
      else
        backup_run=""
      fi
      if { [ ! -e "$stage_root" ] && [ ! -L "$stage_root" ]; } \
        && { [ -z "$backup_run" ] || { [ ! -e "$backup_run" ] && [ ! -L "$backup_run" ]; }; }; then
        break
      fi
      transaction_suffix=$((transaction_suffix + 1))
      transaction_token="$transaction_base-$transaction_suffix"
    done

    if [ "$needs_backup" = "1" ]; then
      for variant in $variants; do
        state_for_variant "$variant"
        if [ "$current_state" = "update" ]; then
          set_variant_metadata "$variant"
          set_planned_backup "$variant" "$backup_run/.previous-$meta_id-$transaction_token"
        fi
      done
    fi

    write_transaction_journal prepared \
      || fail "could not create a durable transaction journal"
    mkdir "$stage_root" || fail "could not create staging directory: $stage_root"
    stage_owned="1"
    write_owned_directory_marker "$stage_root" "$STAGE_MARKER_NAME" \
      || fail "could not mark staging directory ownership"

    if [ "$needs_backup" = "1" ]; then
      [ ! -L "$backup_root" ] || fail "refusing to use a symlinked backup directory: $backup_root"
      mkdir -p "$backup_root" || fail "could not create backup directory: $backup_root"
      [ -d "$backup_root" ] && [ ! -L "$backup_root" ] \
        || fail "backup path is not a regular directory: $backup_root"
      mkdir "$backup_run" || fail "could not create backup location: $backup_run"
      backup_owned="1"
      write_owned_directory_marker "$backup_run" "$BACKUP_MARKER_NAME" \
        || fail "could not mark backup directory ownership"
    fi

    durability_barrier || fail "could not make transaction ownership durable"

    for variant in $variants; do
      stage_variant "$variant"
    done
    durability_barrier || fail "could not make staged assets durable"
  fi

  transaction_active="$needs_stage"
  for variant in $variants; do
    apply_variant "$variant"
  done
  for variant in $variants; do
    verify_active_variant "$variant" \
      || fail "final verification failed for $variant; restoring the previous installation"
  done
  if [ "$needs_stage" = "1" ]; then
    durability_barrier || fail "could not make the verified installation durable"
    commit_publication_started="1"
    write_transaction_journal committed \
      || fail "could not record the verified installation as committed"
  fi
  transaction_active="0"
  commit_publication_started="0"
  cleanup_backup || fail "could not remove the temporary rollback copy safely"
  cleanup_stage || fail "could not remove the temporary staging directory safely"
  if [ "$needs_stage" = "1" ]; then
    durability_barrier || fail "could not make transaction cleanup durable"
  fi
  release_lock || fail "could not remove the installer lock cleanly"

  for variant in $variants; do
    print_result "$variant"
  done

  printf '\nDone. Open Settings > Pets, select Refresh, choose the installed Grok Bot,\n'
  printf 'and enter /pet to wake it.\n'
  printf 'Source: %s\n' "$REPOSITORY_URL"
}

main "$@"
