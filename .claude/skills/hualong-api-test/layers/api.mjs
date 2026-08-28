/**
 * Live HTTP against the contract, through the tunnel.
 *
 * Nothing answers on the app port yet — `hualong-backend/CONTEXT.md` says the
 * service code does not exist. So this layer is written whole and skips itself
 * until something answers, then runs unchanged. That is the point: the day the
 * service ships, nobody has to remember to come back and write this.
 *
 * The tunnel's local port is discovered, never assumed. `dev-access-wizard.ps1`
 * takes the first free of five candidates, so 3001 on this machine is as likely
 * to be something else as to be the tunnel.
 */

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { HOST, TUNNEL_USER, REMOTE_PORT, pickLocalPort } from '../lib/vm.mjs';
import { REPO } from '../lib/findings.mjs';

/** Opens the tunnel exactly as the wizard does, and returns how to close it. */
async function openTunnel() {
  const local = await pickLocalPort();
  const child = spawn('ssh', [
    '-N', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ExitOnForwardFailure=yes',
    '-L', `${local}:127.0.0.1:${REMOTE_PORT}`, `${TUNNEL_USER}@${HOST}`,
  ], { stdio: 'ignore' });

  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    if (child.exitCode !== null) return { local, child, up: false };
    try {
      await fetch(`http://127.0.0.1:${local}/`, { signal: AbortSignal.timeout(1500) });
      return { local, child, up: true };
    } catch { /* not yet */ }
  }
  return { local, child, up: false };
}

export async function api(runReport) {
  const tunnel = await openTunnel();
  try {
    if (!tunnel.up) {
      runReport.skip('api',
        `nothing answers on 127.0.0.1:${REMOTE_PORT} through the tunnel — the service is not deployed`,
        'every runtime question: real status codes, real authorization, real rate limits, real error shapes');
      return;
    }

    const base = `http://127.0.0.1:${tunnel.local}`;
    const { loadSpec, operations } = await import(
      pathToFileURL(join(REPO, 'tools', 'openapi-source.mjs')).href
    );
    const rows = operations(loadSpec());

    // Unauthenticated first. Every non-public operation must refuse, and the
    // contract says 401 for no session — never a body, never a 200.
    const publicPaths = new Set(rows.filter((r) => r.isPublic).map((r) => r.path));
    let leaked = 0;
    for (const row of rows.filter((r) => r.method === 'GET' && !publicPaths.has(r.path) && !r.hasPathParams)) {
      const res = await fetch(base + row.path, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (res && res.status < 400) {
        leaked += 1;
        runReport.add({
          layer: 'api', severity: 'high', kind: 'exposure',
          what: `${row.method} ${row.path} answers ${res.status} with no session`,
        });
      }
    }
    runReport.add({
      layer: 'api', severity: 'low', kind: 'coverage',
      what: `${rows.length} declared operation(s) reachable through the tunnel; ${leaked} answered unauthenticated`,
    });
  } finally {
    tunnel.child.kill();
  }
}
