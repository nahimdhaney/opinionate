# Release Checklist

1. Update `version` in `package.json`
2. Run `pnpm build && pnpm test` — all must pass
3. Commit: `git commit -m "release: v0.x.y"`
4. Tag: `git tag v0.x.y`
5. Publish: `npm publish`
6. Push: `git push && git push --tags`
7. Verify: `npx opinionate@latest doctor`

## Versioning Policy (0.1.x)

- CLI flags are additive — existing flags won't be removed or change meaning
- `DeliberationResult` JSON shape is stable — new fields are additive only
- The installed skill contract (`SKILL.md`) may evolve — re-run `opinionate install` after updates
- Session storage format (`.opinionate/sessions/`) may change between minor versions
