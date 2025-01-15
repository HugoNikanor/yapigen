#!/bin/sh

openapi_spec=tests/run/test-schema.yaml
config_file=tests/run/config.yaml

set -e

# shellcheck disable=SC2154
if test -x "$npm_package_json"; then
	echo This script can only be ran from the package.json file.
	exit 1
fi

outdir_common=/tmp/openapi-generator-test-output
OUTDIR=$outdir_common/$(date +'%FT%T')
export OUTDIR

if command -v openapi-generator >/dev/null; then
	openapi-generator validate -i "$openapi_spec"
	echo
fi

c8 --experimental-monocart --all --reporter=v8 tsx src/entry-point.ts --config "$config_file" "$@"

rm -f "$outdir_common/latest"
ln -s "$OUTDIR" "$outdir_common/latest"

echo
echo "Output files written to $OUTDIR"
