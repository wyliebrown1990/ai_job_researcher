# Deploy — daily schedule

The loop runs on a macOS **launchd** agent at **7:00 AM local**, which invokes
[`scripts/run-daily.sh`](../scripts/run-daily.sh) → `bun run scan run` → emails the
digest to `wyliebrown1990@gmail.com`.

## One-time setup

1. **Configure secrets** (this project's own Resend key):
   ```bash
   cp .env.example .env
   # then edit .env: set RESEND_API_KEY and AJR_EMAIL_FROM
   ```
   Verify your sender domain/address in the Resend dashboard first.

2. **Smoke-test email** (writes the digest and sends it once):
   ```bash
   bun run scan run --force
   ```
   You should see `📧 emailed digest to wyliebrown1990@gmail.com` and receive it.

3. **Install the schedule:**
   ```bash
   cp deploy/com.ajr.daily.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.ajr.daily.plist
   ```

## Manage

```bash
launchctl list | grep com.ajr.daily      # is it registered?
launchctl start com.ajr.daily            # run once now (test the schedule path)
launchctl unload ~/Library/LaunchAgents/com.ajr.daily.plist   # disable
tail -f logs/daily.log                   # watch run output
```

## Change the time

Edit `StartCalendarInterval` (Hour/Minute) in the plist, then `unload` + `load` again.

## Notes

- launchd runs with a minimal environment; `run-daily.sh` sets `PATH` to find `bun`
  at `~/.bun/bin`. If bun lives elsewhere, adjust the `PATH` line in that script.
- If the Mac is asleep at 7:00 AM, launchd runs the job at the next wake. For a
  guaranteed wall-clock run, host it on an always-on machine instead.
- `.env`, `logs/`, and `state/` are gitignored. The committed audit trail is
  `data/seed.json` + `digests/`.
