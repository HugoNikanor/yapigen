#!/bin/sh

OUTDIR=$(mktemp --directory)
export OUTDIR
node dist/src/entry-point.js --config ./tests/run/config.yaml
rm -r "$OUTDIR"
