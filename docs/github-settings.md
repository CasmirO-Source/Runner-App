# GitHub repository settings

Settings for the `Runner-App` repository that live on GitHub rather than in
code. Tick each one when done.

## Access

- [ ] Repository is private (Appendix A #13).
- [ ] Two-factor login on every GitHub account with access (Appendix A #45).

## Code security (Settings > Advanced Security, or Code security and analysis)

- [ ] Dependency graph: on.
- [ ] Dependabot alerts: on (Appendix A #37).
- [ ] Dependabot security updates: on. Version updates come from `.github/dependabot.yml`.
- [ ] Secret scanning and push protection: on if your plan offers them for private repositories. gitleaks covers this either way: on every commit locally, and over the whole history in CI.

## Actions (Settings > Actions > General)

- [ ] Workflow permissions: "Read repository contents and packages permissions" (read-only by default). `ci.yml` also asks for read-only access itself.
- [ ] Allow GitHub Actions to create and approve pull requests: off.
- [ ] Fork pull request workflows: require approval for all outside collaborators.

## Protecting main (Settings > Branches or Rules)

- [ ] Require a pull request before merging into `main`.
- [ ] Require these status checks to pass: "Secret scan (whole history)", "Dependencies, lint, types, design, unit tests", "Database and two-user isolation tests".
- [ ] Block force pushes and deletion of `main`.

Branch protection and rulesets on private repositories need a paid GitHub plan
(Pro, Team or above). On the free plan, CI still runs on every push, but
nothing stops a merge while it is failing, so check it before merging.
