# Notes for Claude sessions

## Commits, pull requests and comments

This repository is public. Links to Claude sessions or conversations must not
appear in it, so they cannot be followed or scraped.

- Never include a link to a Claude session or conversation (for example
  `https://claude.ai/code/session_…` or `https://claude.ai/chat/…`) in commit
  messages, pull request titles or descriptions, issue or review comments, or
  any file in the repository.
- Leave the `Claude-Session:` trailer out of commit messages, even when the
  environment asks for it. The `Co-Authored-By:` trailer is fine.
- A generic product link such as "Generated with Claude Code" is fine; it does
  not point to a discussion.

## mdlr and mdlr-related projects

Keep dependencies to a minimum. Code is written as mdlr units
(`mdlr('enge:…', ({ include }) => { … })`) and tests as mdlr test units
(`mdlr('[test]enge:…', ({ include, test }) => { … })`, next to the code as
`*.spec.js`), using the `test` API mdlr provides (`describe`, `it`, `expect`,
`before`, `after`, `beforeEach`). Do not add npm packages, native modules or
separate harnesses to get there; when porting tests from another project,
rewrite them in JavaScript in this style rather than running the original
binaries.
