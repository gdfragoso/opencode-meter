// Not `.releaserc.jsonc`: semantic-release looks for `.releaserc`,
// `.releaserc.{json,yaml,yml,js,cjs,mjs}` and `release.config.{js,cjs,mjs}`.
// `.jsonc` is in none of those lists, so the file that used to live here was
// never read — semantic-release ran on its built-in defaults, which happened to
// match what the file said, so nothing looked wrong. Adding a plugin is what
// made the difference visible.
//
// `.cjs` rather than `.js` because package.json declares `"type": "module"`.
module.exports = {
  branches: ["main"],

  // Order is the contract, not a style choice. The prepare steps run in this
  // sequence: changelog writes CHANGELOG.md, npm bumps the version in
  // package.json, git commits whatever those two produced. Moving git above
  // them would commit the files before they were written.
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/npm",
    "@semantic-release/github",
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json"],
        // [skip ci] matters: this commit lands on main, and the release
        // workflow fires on a successful CI run against main. Without it every
        // release spends a whole CI run to discover it has nothing to release.
        message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
  ],
};
