# Migration Guides

This directory contains upgrade guides for every **major** release of this project.

Each major version has its own file, named after the version you are upgrading **to**:

- [`v0.md`](./v0.md) — upgrading to v0
- [`v1.md`](./v1.md) — upgrading to v1

As new major versions are released, a corresponding `vN.md` file is added here (e.g. `v2.md`, `v3.md`, ...).

## How to use these guides

1. **Find your current version.** Check the `version` field in your `package.json` (or the equivalent for your setup).
2. **Find your target version.** This is the version you want to upgrade to.
3. **Read every guide in between.** If you are upgrading from `v0` to `v2`, read `v1.md` and `v2.md` in order. Breaking changes are cumulative — a change introduced in `v1` still applies when jumping straight to `v2`.
4. **Follow the steps in each guide** before moving on to the next one.

If you are already on the latest major version and only upgrading within it (a minor or patch release), you generally do not need these guides — see the changelog for details.

## Source of truth

These guides summarize the **breaking changes** for each major release. The authoritative record of every change lives in:

- [`CHANGELOG.md`](../../CHANGELOG.md) — the generated changelog for all releases.
- The [`.changeset/`](../../.changeset/) directory — the individual changeset entries that describe each change as it was made.

If a guide and the changelog ever disagree, treat the changelog and changeset entries as correct, and please open an issue so the guide can be fixed.

## Contributing

A new migration guide **must** be added for every major release. When preparing a major version:

1. Create `docs/migrations/vN.md` for the new major version `N`.
2. List each breaking change, what it affects, and the migration steps required.
3. Add a link to the new file in the list at the top of this README.
4. Cross-reference the relevant changeset entries and changelog sections.