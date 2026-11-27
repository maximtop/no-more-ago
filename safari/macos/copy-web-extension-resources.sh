#!/bin/bash

set -euo pipefail

: "${NO_MORE_AGO_WEB_EXTENSION_PATH:?Missing WebExtension source path}"
: "${NO_MORE_AGO_WEB_EXTENSION_RESOURCE_LIST:?Missing WebExtension resource list}"
: "${TARGET_BUILD_DIR:?Missing target build directory}"
: "${UNLOCALIZED_RESOURCES_FOLDER_PATH:?Missing target resource path}"

destination_root="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH"

while IFS= read -r relative_path; do
    [[ -n "$relative_path" ]] || continue
    if [[ "$relative_path" == /* \
        || "$relative_path" == ".." \
        || "$relative_path" == ../* \
        || "$relative_path" == */../* \
        || "$relative_path" == */.. ]]; then
        echo "Unsafe WebExtension resource path" >&2
        exit 1
    fi

    source_path="$NO_MORE_AGO_WEB_EXTENSION_PATH/$relative_path"
    destination_path="$destination_root/$relative_path"
    [[ -f "$source_path" ]] || {
        echo "Missing WebExtension resource: $relative_path" >&2
        exit 1
    }
    /bin/mkdir -p "$(/usr/bin/dirname "$destination_path")"
    /bin/cp -p "$source_path" "$destination_path"
done < "$NO_MORE_AGO_WEB_EXTENSION_RESOURCE_LIST"
