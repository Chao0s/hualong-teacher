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

COS needs `COS_SECRET_ID` and `COS_SECRET_KEY` in the environment. The v5
signature is implemented in `lib/cos.mjs`, so nothing has to be installed on
this machine or on the VM. A missing variable is a named error, never a silent
skip. **Never** write a credential into a file, a report, or a commit.

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

## What this does not do

No load testing, no fuzzing, no rate-limit hammering. The box is a 5 Mbps
single-AZ instance that will serve a working kindergarten; traffic that looks
like an attack is not worth the finding. Authorization probing with real
identities waits until a service exists to probe.
