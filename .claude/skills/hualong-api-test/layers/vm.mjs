/**
 * The host: whether the hardening the documents claim is actually in force.
 *
 * `Hualong Platform/tools/README.md` records that a `devtunnel` key was
 * verified to reach one port and no shell. A verification is a fact about a
 * moment; this layer makes it a fact about now. The Lighthouse console has no
 * key pair bound (密钥: 前往绑定), so SSH identity lives entirely in
 * `authorized_keys` and there is no console-side way back in if it breaks —
 * which is why nothing here writes to that file.
 */

import { ssh, adminReachable, REMOTE_PORT } from '../lib/vm.mjs';

/** Listeners bound past loopback. Written without quoting awkward characters. */
const EXPOSED = 'ss -lntH 2>/dev/null | tr -s " " | cut -d" " -f4 | grep -v "^127[.]" | grep -v "^\\[::1\\]" || true';

export async function vm(runReport) {
  if (!await adminReachable()) {
    runReport.skip('vm', 'the ubuntu shell is unreachable',
      'sshd hardening, the devtunnel restrictions, what is exposed on :80, and disk headroom');
    return;
  }

  const sshd = await ssh('sudo sshd -T 2>/dev/null | grep -E "^(permitrootlogin|passwordauthentication)" || true');
  const settings = Object.fromEntries(
    sshd.trim().split('\n').filter(Boolean).map((l) => l.trim().split(/\s+/)),
  );
  for (const [key, want] of [['permitrootlogin', 'no'], ['passwordauthentication', 'no']]) {
    if (settings[key] !== want) {
      runReport.add({
        layer: 'vm', severity: 'high', kind: 'hardening-off',
        what: `sshd ${key} is "${settings[key] ?? 'unreadable'}", not "${want}"`,
      });
    }
  }

  // The second line of defence the manager writes in front of every key.
  const restricted = await ssh('sudo grep -c permitopen /home/devtunnel/.ssh/authorized_keys 2>/dev/null || echo 0');
  const total = await ssh('sudo grep -cE "^[^#[:space:]]" /home/devtunnel/.ssh/authorized_keys 2>/dev/null || echo 0');
  const unrestricted = Number(total.trim()) - Number(restricted.trim());
  if (unrestricted > 0) {
    runReport.add({
      layer: 'vm', severity: 'high', kind: 'hardening-off',
      what: `${unrestricted} devtunnel key(s) carry no permitopen restriction`,
    });
  } else {
    runReport.add({
      layer: 'vm', severity: 'low', kind: 'coverage',
      what: `${total.trim()} devtunnel key(s), all carrying permitopen`,
    });
  }

  const permitOpen = await ssh('sudo sshd -T -C user=devtunnel 2>/dev/null | grep -i permitopen || true');
  if (!permitOpen.includes(`127.0.0.1:${REMOTE_PORT}`)) {
    runReport.add({
      layer: 'vm', severity: 'high', kind: 'hardening-off',
      what: `the devtunnel Match block does not restrict forwarding to 127.0.0.1:${REMOTE_PORT}`,
      detail: permitOpen.trim() || '(no PermitOpen in effect)',
    });
  }

  const ports = (await ssh(EXPOSED)).trim().split('\n').filter(Boolean);
  if (ports.length) {
    runReport.add({
      layer: 'vm', severity: 'medium', kind: 'exposure-surface',
      what: `${ports.length} listener(s) bound beyond loopback`,
      detail: ports,
    });
  }

  const webroot = await ssh('ls /var/www/html 2>/dev/null | head -2 || true');
  if (webroot.includes('index.nginx-debian.html')) {
    runReport.add({
      layer: 'vm', severity: 'medium', kind: 'exposure-surface',
      what: 'port 80 serves the stock nginx placeholder page, publicly and without TLS',
    });
  }

  // Must name postgres, not merely "backup". The first version of this check
  // passed on dpkg-db-backup.timer -- Debian's package-database dump, which has
  // nothing to do with the database holding the children's records. A backup
  // check that goes green on the wrong backup is worse than no check.
  const backupJob = await ssh(
    '( sudo crontab -l 2>/dev/null; sudo -u postgres crontab -l 2>/dev/null; ' +
    'sudo ls /etc/cron.d /etc/cron.daily 2>/dev/null; ' +
    'systemctl list-timers --all --no-pager 2>/dev/null ) ' +
    '| grep -iE "pg_dump|pgdump|postgres.*(dump|backup)|(dump|backup).*postgres" || true',
  );
  if (!backupJob.trim()) {
    runReport.add({
      layer: 'vm', severity: 'high', kind: 'data-loss',
      what: 'nothing schedules a PostgreSQL dump — no cron entry and no timer names pg_dump or postgres, ' +
        'against CONTEXT.md line 69 which states a daily 05:00 pg_dump to COS with restore tested',
    });
  } else {
    runReport.add({
      layer: 'vm', severity: 'low', kind: 'coverage',
      what: 'a PostgreSQL dump is scheduled',
      detail: backupJob.trim().split(/\r?\n/).slice(0, 3),
    });
  }

  const disk = await ssh('df -h / | tail -1 | tr -s " " | cut -d" " -f5,2');
  runReport.add({ layer: 'vm', severity: 'low', kind: 'coverage', what: `disk: ${disk.trim()}` });
}
