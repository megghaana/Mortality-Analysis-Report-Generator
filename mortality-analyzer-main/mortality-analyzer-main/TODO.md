- [ ] Inspect `server.ts` DB init/auth flow (already done)
- [x] Implement DNS-failure recovery improvements in `server.ts`
  - [x] Add broader DNS error detection
  - [x] Recreate `pg.Pool` after DNS cooldown to force re-resolution
  - [ ] Add safe DNS/connection diagnostics logs
  - [x] Remove/adjust conflicting background `initDb()` catch that can re-toggle fallback
- [ ] Run TypeScript build/lint or dev smoke test
- [ ] Verify fallback-to-DB recovery behavior via logs

