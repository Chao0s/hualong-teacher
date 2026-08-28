---
name: hualong-api-test
description: Test every seam between the Tencent Cloud VM, the three clients, and COS object storage. Checks the live database against the DDL, the bucket against its policy, the VM against its hardening, and each client's service layer against the API contract; arms the live HTTP layer automatically the day a service is deployed. Use when asked to check the backend, audit the cloud environment, look for missing or drifted API calls, verify the published Swagger site, hunt authorization or exposure problems, or confirm the backups are real.
---

# hualong-api-test

Tests the real Tencent Cloud deployment. GitHub holds the expectations; the
cloud is the thing under test.

## What it is for

Three entities have to agree, and nothing checks that they do:

| Entity | Where | Authority over |
| --- | --- | --- |
| VM | `106.55.2.218`, Tencent Lighthouse Guangzhou 4 (`lhins-kepjn8fb`) | the database, the HTTP service, the tunnel |
| Clients | `hualong-teacher`, `hualong-parent`, `hualong-admin-pc` | which paths get called, with which fields |
| COS | `hualong-media-1464472146`, Guangzhou, private, SSE-COS | every photo, every backup |

The failures this catches are the quiet ones. A client calling a path the
contract never gained is invisible until a screen is blank — it happened four
times before a test existed, and a fifth time on 2026-08-27 when three
`/teacher-profile` operations were cited in a commit message that does not
exist. A backup that stopped running looks exactly like a backup that runs. A
bucket that went public looks exactly like a bucket that did not.

## Rules

1. **Never write to production.** No DDL against the live database, no object
   deleted from COS, no file edited on the VM. Reads only. The one exception is
   the SSH tunnel, which the VM's own config permits.
2. **Propose, never push.** Findings and fixes are written out and reported.
   Every commit, every PR, every `repository_dispatch` waits for a human yes.
3. **`db/01_schema.sql` is authority**, per `hualong-backend/AGENTS.md`. When
   the live database disagrees with it, the database is what is wrong.
4. **Siblings are read-only.** `hualong-backend`, `hualong-parent` and
   `hualong-admin-pc` are read. The single exception is a schema-migration PR,
   which follows the approve-then-open flow.
5. **A skipped check says why.** Never report absence as success. Two of the
   three clients hold no service layer yet and the service on `3001` does not
   exist; those layers must say so rather than pass silently.

## Access

Two routes onto the VM, and a check must declare which it needs.

| Route | Reaches | Who can run it |
| --- | --- | --- |
| `devtunnel@106.55.2.218` tunnel | the app port only, through a local port it must discover | anyone on the team |
| `ubuntu@106.55.2.218` shell | everything: Postgres, nginx, cron, disk | Herman only |

The tunnel is what `Hualong Platform/tools/dev-access-wizard.ps1` opens. Its
local port is **not** 3001 — the wizard takes the first free of
`3001, 13001, 23001, 33001, 43001`, then any free port. Discover it; never
assume it. `permitopen="127.0.0.1:3001"` is written in front of every
`devtunnel` key, so that route reaches one port and nothing else.

### COS

Split in two on purpose.

The **unauthenticated** probe runs from this machine, because "can a stranger
read the bucket" is a question about what the internet sees. Asked from inside
the VM's own region it would answer something else. It needs no credential, so
it runs before anything can skip. `lib/cos.mjs` signs v5 requests itself, so
nothing has to be installed here either.

Everything **credentialed** runs on the VM. The key is already there —
`/etc/hualong/cos.env`, sourced by `backup-db.sh` since 2026-08-18 — and
copying a write-capable key to a second machine to answer a read-only question
puts it somewhere nobody remembers to rotate. `vm-cos-probe.py` is piped in over
ssh stdin, so nothing is written to the server, and it returns findings, never
values.

That half also answers what the VM alone cannot. `backup-db.sh` writes a local
dump and then uploads it, so a failed upload leaves a healthy-looking file
behind. Only the bucket knows whether the copy arrived.

`lib/cos.mjs` still accepts `COS_SECRET_ID` and `COS_SECRET_KEY` from the
environment for running against a bucket the VM cannot reach. A missing
variable is a named error, never a silent skip. **Never** write a credential
into a file, a report, or a commit.

### The permission border

The key that runs the nightly backup sits on a host reachable from the
internet, so what it can reach beyond its one bucket matters more than
convenience. Two accounts, two jobs:

| Account | Needs | Must not have |
| --- | --- | --- |
| `hualong-api` (the server runs as this) | `PutObject`, `GetObject` on the one bucket — enough to upload a dump | anything account-wide, and any bucket-config write |
| a read-only account for these checks | `GetBucketACL`, `GetBucketCORS`, `GetBucketEncryption`, `GetBucketLifecycle` | every write, and `GetService` |

`cos:GetService` is account-wide by construction — it lists every bucket you
own, and no resource clause narrows it. Nothing in this skill needs it: the
bucket name is fixed in `lib/cos.mjs`. The `reach` check reports it when
granted, which is how the border stops being a decision someone made once.

The bucket-config **writes** are the ones worth refusing outright.
`DeleteBucketLifecycle` changes how long backups are kept.
`DeleteBucketCORS` breaks client uploads, and it will look like a client bug.
A checker that only reads should hold neither.

## Layers

```
node .claude/skills/hualong-api-test/run.mjs            # every layer
node .claude/skills/hualong-api-test/run.mjs cos db     # named layers
```

| Layer | Needs | Checks |
| --- | --- | --- |
| `contract` | nothing | every client's service layer against the contract; every contract operation against the mock |
| `db` | `ubuntu` shell | live Postgres against `db/01_schema.sql` — tables, columns, enums |
| `cos` | `COS_*` env | bucket ACL and policy, SSE, CORS, backup presence and freshness, and one anonymous read attempt |
| `vm` | `ubuntu` shell | sshd hardening in force, `devtunnel` restrictions, nginx exposure, disk |
| `api` | tunnel | live HTTP against the contract. Self-skips while `3001` is unanswered |

## Severity, and what fails the run

Exit is non-zero only for exposure or data loss:

- an object readable by an unauthenticated stranger
- sshd hardening not actually in force, or `devtunnel` reaching a second port
- the backup missing, or newer than nothing but older than a day
- a client calling a path the contract does not declare

Everything else — schema drift, a missing CORS rule, no TLS on a placeholder
page — is reported without failing. An exit code that is red for weeks stops
being read.

## Reports

A severity-ranked summary goes to the terminal; the full run is written to
`tools/.report/api-test/<timestamp>.json`, which is gitignored. Keeping the
runs is how a backup that silently stops becomes visible: one run cannot show
it, two can.

## Flow

1. Run the layers, gathering findings. A layer that cannot run records why.
2. Report, ranked. State plainly what was skipped and what that leaves unknown.
3. For contract drift, write the missing operations as a proposed diff.
4. For schema drift, generate the migration into the report directory.
5. Stop. Ask before opening any PR, before any commit, before firing
   `repository_dispatch` to republish the docs site.

## When the service lands on 3001

The `api` layer today asks one question: does any non-public path answer without
a session. That is all a live check can ask before there is anything to log in
to. What follows is what it should gain, in the order the value falls, so the
work is not re-derived when the port starts answering.

**1. A session.** Everything below needs one. `POST /auth/session` is two-stage,
so the layer needs a seeded test identity in the real database — which is a
decision, not an implementation detail: a test teacher in production data is a
real account with real reach. Ask before creating one.

**2. Breadth, live.** What `tests/api-coverage.test.mjs` does against the mock,
done against the service: every teacher-reachable operation, its declared
success code, its declared response shape. The mock proves the contract is
self-consistent; only this proves the service implements it.

**3. Authorization — the red line.** `x-hualong-scope` on each operation says
what the server must re-verify inline. Drive a teacher's token at another
class's child and confirm **404, not 403** (§7.2 — a 403 confirms the object
exists, which is itself the leak). This needs two seeded identities in different
classes and is the highest-value check on this list, because it is the one no
amount of reading the contract can settle.

**4. Derived fields are ignored, not rejected.** §7.3 says submitting
`school_id`, `created_by` or `uploaded_by` is silently dropped. A service that
errors instead breaks clients; one that *honours* them is a privilege
escalation. Send them and read back what stuck.

**5. The envelope.** `*_at` carries a literal `+08:00`, never `Z` and never a
conversion. Cursor pages carry `next_cursor` and never `total`. Errors take one
shape. Each is a one-line assertion and each has already been got wrong once in
the client.

**6. Idempotency.** Replay a write with the same `Idempotency-Key` and the
original status and body must come back — not a second row. §4.2.

**7. Rate-limit headers present.** §5.3 says `x-ratelimit-*` ride every
response, under the limit as well as over. Reading them is free; *provoking*
the limit is not, and is out of scope.

Items 2 through 7 are read-mostly and safe to run against a dev instance. None
of them should point at production data until there is a reason.

**One permission will break on deploy day.** `hualong-api-backup` is scoped to
`.../hualong-media-1464472146/backups/db/*` — the nightly dump and nothing
else. The service's actual job is issuing presigned credentials for photo
uploads, which land under a media prefix that policy does not cover. The first
upload will fail with a COS `AccessDenied` surfacing through the client, so it
will look like a bug in the upload code rather than a missing grant, and the
hour goes into the wrong file.

Fix it with a separate `hualong-api-media` policy rather than by widening the
backup one: the two jobs fail differently and should be revocable
independently. A key that can overwrite backups because it also needed to write
photographs is how a ransomware incident becomes unrecoverable.

## What this does not do

No load testing, no fuzzing, no rate-limit hammering. The box is a 5 Mbps
single-AZ instance that will serve a working kindergarten; traffic that looks
like an attack is not worth the finding. Authorization probing with real
identities waits until a service exists to probe.
