# Deploying project-dashboard

## The ownership model

`/opt/project-dashboard` is a **deployment target, not a workspace**.

- It is owned **entirely by the service user** `project-dashboard`, which also
  owns `.git` and `api/node_modules`.
- **This deploy pipeline is the only thing that writes to it.**
- Contributors (agents, humans) never touch it. They work in their own clone,
  push to GitHub, then trigger a deploy.

This exists because sharing one git working directory between several agents
produced a cluster of unrelated-looking failures: mysqldump missing, an
unwritable backup directory, SSH aliases that resolved only for root, corrupt git
objects, `.git/objects` files owned by root that blocked every fetch, polkit
authentication prompted from the wrong identity, a `dotenv` module that had to
exist before it could be installed, and npm caches full of root-owned files.
Every one of them had the same root cause: **several identities writing one
working tree.** Single owner, many contributors removes the cause.

### Hard rules for contributors

1. Do not write to `/opt/project-dashboard`.
2. Do not run any git write operation there (`add`, `commit`, `pull`, `checkout`,
   `reset`, `fetch`).
3. Do not restart `project-dashboard.service`.
4. Do not run database migrations.
5. If `/opt/project-dashboard` looks wrong (ownership drift, damaged objects,
   permission errors), **report it and stop** — do not try to repair it.

Clone your own copy instead, e.g. `/home/<agent>/repos/project-dashboard`.

## Where this came from

The pipeline below is the manual one that was used to deploy commit `dbd627d`
after the incident, moved into version control. Previously it lived only in
`/root` (`deploy-project-dashboard.sh`, `final-deploy.sh`, `prep-and-deploy.sh`),
owned by root: unreviewable, unversioned, and lost if the VPS died.

Ported unchanged in behaviour:

| Behaviour | Why it stays |
| --- | --- |
| Back up `.env`, previous commit, `mysqldump`, uploads before touching code | a deploy must be reversible |
| `git merge --ff-only` plus an ancestry check | never silently rewrite the target |
| Refuse to deploy on a dirty working tree | single owner means local changes are an anomaly, not drift to discard |
| `npm ci` then `npm run db:migrate` | the pipeline owns the schema |
| Readiness gate on `/api/ready` after the restart | a deploy that leaves the app down must fail |

Changed deliberately:

| Change | Reason |
| --- | --- |
| The `.env` is parsed with plain node instead of importing `dotenv` from `api/node_modules` | the old version could not read its own config until `npm ci` had run — install and config were mutually dependent |
| Owned by systemd instead of hand-run as root | one reviewed entry point, and it can be triggered by CI or a webhook |
| `systemctl restart` moved behind systemd's `+` prefix | the app restart needs root, the git work must not have it; doing the split in systemd means **no polkit rule is needed** — the previous setup depended on a `.pkla` file that only works on polkit 0.105 |
| Restart only when the checkout moved | a poll that finds nothing new costs one fetch and no outage |
| Ownership precheck **includes `.git`** | the old `final-deploy.sh` pruned `.git` and `node_modules` from its ownership repair, so the fast path could not heal the two failures that actually occur there (`.git/objects` written by root, root files in `node_modules`) |
| Backup retention (default: newest 20) | unbounded dumps fill the disk |

## Files

| File | Runs as | Purpose |
| --- | --- | --- |
| `deploy-project-dashboard.sh` | service user | fetch → verify → back up → update → install → migrate |
| `deploy-project-dashboard-restart.sh` | root (via `+`) | conditional restart, then the `/api/ready` gate |
| `project-dashboard-deploy.service` | `oneshot` | wires the two together |
| `project-dashboard-deploy.timer` | — | optional 5-minute polling |

## Install (one time, as root)

```bash
cd /path/to/your/clone
sudo install -m 755 deploy/deploy-project-dashboard.sh         /usr/local/bin/deploy-project-dashboard
sudo install -m 755 deploy/deploy-project-dashboard-restart.sh /usr/local/bin/deploy-project-dashboard-restart
sudo install -m 644 deploy/project-dashboard-deploy.service    /etc/systemd/system/
sudo install -m 644 deploy/project-dashboard-deploy.timer      /etc/systemd/system/
sudo systemctl daemon-reload
```

Make sure the target is service-owned before the first run — the script refuses
to touch a target it does not own:

```bash
sudo chown -R project-dashboard:project-dashboard /opt/project-dashboard
find /opt/project-dashboard ! -user project-dashboard | wc -l   # must print 0
```

The service user also needs its own git access (SSH config and deploy key), a
writable backup root, and a state directory:

```bash
sudo install -d -o project-dashboard -g project-dashboard -m 750 /var/backups/project-dashboard
sudo install -d -o project-dashboard -g project-dashboard -m 755 /var/lib/project-dashboard
sudo -u project-dashboard ssh -T git@github-project-dashboard   # must authenticate
```

`/var/lib/project-dashboard` holds `deployed-sha`, which records the commit the
app is actually running. The restart step writes it as root but hands it back to
the owner of that directory, so no root-owned file lands in a service-user tree.

## Deploy

```bash
sudo systemctl start project-dashboard-deploy
journalctl -u project-dashboard-deploy -n 60 --no-pager
```

Or let it poll:

```bash
sudo systemctl enable --now project-dashboard-deploy.timer
```

A push to GitHub does not deploy by itself. Trigger the unit, enable the timer,
or point a webhook at `systemctl start project-dashboard-deploy`.

## Knobs (unit `Environment=`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DEPLOY_BACKUP_KEEP` | `20` | newest N backups to keep; `0` disables pruning |
| `DEPLOY_STOP_FOR_BACKUP` | `0` | `1` stops the app first, for a frozen backup instead of `--single-transaction` |
| `DEPLOY_EXPECTED_COMMIT` | unset | if set, the remote must contain this sha |
| `DEPLOY_DISCARD_DRIFT` | `0` | `1` throws away local changes in the target instead of stopping |
| `DEPLOY_STATE_DIR` | `/var/lib/project-dashboard` | where `deployed-sha` is recorded |
| `DEPLOY_INSTALL_DEPS` | `1` | run `npm ci` |
| `DEPLOY_MIGRATE` | `1` | run `npm run db:migrate` |
| `DEPLOY_SKIP_RESTART` | `0` | `1` records activation and verifies readiness without restarting |

## Interrupted deploys

The checkout and the running process are two different things, so the pipeline
tracks both.

`deploy-project-dashboard.sh` compares the commit in the working tree with
`deployed-sha`. If they differ it asks for a restart **even when the files are
already up to date**. That closes a silent failure: a deploy killed after the
fast-forward but before the restart used to leave the files updated, the old code
still serving, and every later run reporting "nothing to do" -- so the change
never took effect. Now the next run finishes the job.

The two interruption windows and what to do:

| Killed during | State left behind | Recovery |
| --- | --- | --- |
| Backup, before any change | nothing changed | just re-run |
| After the fast-forward | files updated, not activated | just re-run; it requests the restart |
| **Inside the fast-forward** | working tree partially checked out (dirty), possibly `.git/index.lock` | fail-closed: the run stops and says so. Verify nothing else is running, remove the lock, then `sudo -u project-dashboard git -C /opt/project-dashboard reset --hard origin/main` and re-run |

A second run never starts while the first is still going: the unit is
`Type=oneshot`, so systemd merges the start job instead of forking a second
process. Do not invoke the sync script by hand in parallel with the unit.

## Verify a deploy

```bash
systemctl status project-dashboard-deploy
find /opt/project-dashboard ! -user project-dashboard | wc -l    # must be 0
sudo -u project-dashboard git -C /opt/project-dashboard rev-parse HEAD
curl -s localhost:3100/api/ready
```

## Troubleshooting

**`could not update ref` / `unable to update ref: Permission denied`, or
`insufficient permission for adding an object`** — refs or objects inside `.git`
were written by another identity. This is the failure the model prevents; repair
ownership and re-run:

```bash
sudo chown -R project-dashboard:project-dashboard /opt/project-dashboard/.git
```

**`STOP: the deployment target has local changes.`** — either something wrote to
the target, or a previous deploy was killed inside the fast-forward. Find out
which before overriding:

```bash
sudo -u project-dashboard git -C /opt/project-dashboard status --short
sudo -u project-dashboard git -C /opt/project-dashboard log --oneline -1
```

If `HEAD` already equals the commit you expected and the tree is only partially
updated, that is git's own interrupted checkout: `reset --hard origin/main`
finishes it. If foreign edits are there instead, investigate first.

**`... .git/index.lock exists`** — a git operation was interrupted, or another
deploy is still running. The run stops before changing anything. Confirm nothing
is running, remove the file, re-run.

**`history diverged`** — the target has commits that GitHub does not. Do not
force it; decide deliberately whether that work matters.

**Authentication prompt from the wrong user** — polkit is being asked to
authorise `systemctl` from an unprivileged context. This pipeline avoids that by
having systemd run those steps as root. If you see it anyway, check the version
before writing rules: polkit **0.105** reads
`/etc/polkit-1/localauthority/50-local.d/*.pkla`, while **0.106+** reads
`/etc/polkit-1/rules.d/*.rules`. Rules in the wrong format are ignored silently.

**Local edits in the target disappeared** — only possible with
`DEPLOY_DISCARD_DRIFT=1`; the default stops instead. Single owner means the target
holds no authored work: author in a clone and push.

## Backup and rollback

Each deploy writes `$DEPLOY_BACKUP_ROOT/project-dashboard-<timestamp>-<sha>/`
containing `database.sql`, `uploads.tar.gz`, `environment.backup` and
`previous-commit.txt`.

```bash
# roll the code back
sudo -u project-dashboard git -C /opt/project-dashboard reset --hard "$(cat <backup>/previous-commit.txt)"
# restore the database
mysql --defaults-extra-file=<creds> <db> < <backup>/database.sql
# restore uploads
tar -xzf <backup>/uploads.tar.gz -C /opt/project-dashboard
sudo systemctl restart project-dashboard
```

Migrations are forward-only; restoring the dump is the way back.
