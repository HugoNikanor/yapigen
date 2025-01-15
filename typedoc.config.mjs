/* -*- mode: javascript -*- */

import MarkdownItFootnote from 'markdown-it-footnote'

export default {
  name: 'Openapi Generator',
  entryPoints: ['src'],
  entryPointStrategy: 'expand',
  exclude: ['build/'],
  out: 'docs',
  searchInComments: true,
  searchInDocuments: true,
  useFirstParagraphOfCommentAsSummary: true,
  requiredToBeDocumented: [
    'Project',
    'Module',
    'Namespace',
    'Enum',
    'EnumMember',
    'Variable',
    'Function',
    'Class',
    'Interface',
    // 'Constructor'
    'Method',
    //
    'Parameter',
    'TypeAlias',
    /* Accessors */
    'GetSignature',
  ],
  markdownItOptions: {
    linkify: true,
    html: true,
  },
  includeVersion: true,
  markdownItLoader(parser) {
    parser.use(MarkdownItFootnote)
  },
}
