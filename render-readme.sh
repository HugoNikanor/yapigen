#!/bin/sh

readme_template=README-template.md
readme=README.md

if command -v pandoc >/dev/null
then
	table_of_contents=$(pandoc -f gfm --toc -s -i "$readme_template" -t gfm | sed -e '/^$/,$d' | tail -n+2)
	export table_of_contents

	awk "
	BEGIN { print \"<!-- File auto-generated from $readme_template, using $0. Local changes WILL be overwritten -->\" }
	END {
		print \"<!--\"
		print \"Local Variables:\"
		print \"eval: (read-only-mode)\"
		print \"End:\"
		print \"vim:ro\"
		print \"-->\"
	}
	/TOC_PLACEHOLDER/ { print ENVIRON[\"table_of_contents\"]; next }
	{print}" \
		"$readme_template" \
		> "$readme"
else
	cat - >&2 <<- EOF
		Pandoc not found on system. Copying README placeholder verbatim.
		This will omit the table of contents from the readme
	EOF
fi

if command -v dot >/dev/null
then
	dot doc/generated-deps.gv -Tsvg -o doc/generated-deps.svg
else
	cat - >&2 <<- EOF
		Graphviz (dot) not found on the system. Images will NOT be updated.
	EOF
fi
