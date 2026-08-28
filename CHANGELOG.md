# [2.0.0](https://github.com/gdfragoso/opencode-meter/compare/v1.1.0...v2.0.0) (2026-08-28)


* feat(tools)!: remove the per-tool and per-agent cost estimates ([db7f105](https://github.com/gdfragoso/opencode-meter/commit/db7f105e23498d4ff4d42a559a0526b8849892da))


### BREAKING CHANGES

* /api/tools and /api/tool-metrics no longer return total_tokens
or total_cost; /api/cost-efficiency no longer returns byTool or byAgent; and
/api/sessions/:id/tools returns {name, count}. The per-tool and per-agent cost
figures were estimates that divided a step's cost by how long each tool ran,
which is close to anticorrelated with what drives the bill. The only consumer of
these fields is this repository's own dashboard.

# [1.1.0](https://github.com/gdfragoso/opencode-meter/compare/v1.0.1...v1.1.0) (2026-08-27)


### Features

* **dashboard:** analytics suite — delegation tree, cost per result, period comparison, cache over time ([#4](https://github.com/gdfragoso/opencode-meter/issues/4)) ([02d46f5](https://github.com/gdfragoso/opencode-meter/commit/02d46f5a2c3fdffdef2c4445c881217ea4634259))
