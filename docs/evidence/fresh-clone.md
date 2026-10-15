# Fresh-clone verification (Phase 8, 15 Oct 2026)

Followed the README exactly in an empty directory, cloned from GitHub
(`claude/amazing-cerf-exbnex` at `dd69c10`), with Node 22.22.0 and `compact` 0.5.1 / toolchain 0.31.1.

| Step                     | Command                 | Result                                                                     |
| ------------------------ | ----------------------- | -------------------------------------------------------------------------- |
| Install                  | `npm ci`                | ok                                                                         |
| Compile contract         | `npm run compact`       | 4 circuits compiled, keys generated                                        |
| Tests                    | `npm test`              | contract 33/33, SDK 67/67                                                  |
| Lint + typecheck         | `npm run lint`          | ok                                                                         |
| Licence headers          | `npm run license:check` | 52 source files OK                                                         |
| Format                   | `npm run format:check`  | ok                                                                         |
| Build all packages + app | `npm run build`         | ok                                                                         |
| Local end-to-end         | `npm run e2e:local`     | all checks passed, 6 transactions                                          |
| CI (GitHub Actions)      | push                    | success: https://github.com/Emediong-Etuk/AgePass/actions/runs/38710923150 |
