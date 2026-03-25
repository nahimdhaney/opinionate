# Release Checklist

1. Update `version` in `package.json`
2. Run `pnpm build && pnpm test && pnpm run test:packaging` — all must pass
3. Verify install-script passthrough and packaged installer in a temp project:

   ```bash
   tmp_repo=$(mktemp -d "$PWD/.opinionate-release-XXXXXX")
   pnpm run install-skill -- --cwd "$tmp_repo"
   test -f "$tmp_repo/.claude/skills/opinionate/SKILL.md"
   ```

4. If Codex CLI is available locally, verify doctor against the temp project:

   ```bash
   node dist/src/cli.js doctor --cwd "$tmp_repo"
   ```

   Note: a temp directory outside a trusted Codex workspace may fail the auth probe even when `codex login` is valid.

5. Commit: `git commit -m "release: v0.x.y"`
6. Tag: `git tag v0.x.y`
7. Publish: `npm publish`
8. Push: `git push && git push --tags`
9. Verify: `npx opinionate@latest doctor`

## Versioning Policy (0.1.x)

- CLI flags are additive — existing flags won't be removed or change meaning
- `DeliberationResult` JSON shape is stable — new fields are additive only
- The installed skill contract (`SKILL.md`) may evolve — re-run `opinionate install` after updates
- Session storage format (`.opinionate/sessions/`) may change between minor versions
