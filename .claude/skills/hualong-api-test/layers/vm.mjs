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

const NEWLINE = new RegExp('\\r?\\n');

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

  // ADR-0016 §9: GitHub holds a key that reaches this box, restricted to one
  // forced command. That restriction is the only thing standing between a
  // deploy key and a shell on the machine holding the children's records, and
  // it is one careless authorized_keys edit away from being gone. Nothing warns
  // you; the deploy keeps working either way.
  const deployKeys = await ssh(
    'sudo grep -rhi "github\\|deploy" /home/*/.ssh/authorized_keys /root/.ssh/authorized_keys 2>/dev/null || true',
  );
  const deployLines = deployKeys.trim().split(NEWLINE).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (!deployLines.length) {
    runReport.skip('vm/deploy-key', 'no deploy key on the box yet — ADR-0016 §9 is chosen but not built',
      'whether the key GitHub holds is restricted to one command, or can open a shell');
  } else {
    for (const line of deployLines) {
      const restricted = line.includes('command=') && line.includes('restrict');
      runReport.add(restricted
        ? { layer: 'vm', severity: 'low', kind: 'coverage', what: 'the deploy key is locked to a forced command' }
        : {
          layer: 'vm', severity: 'high', kind: 'hardening-off',
          what: 'a deploy key carries no command= restriction — whoever holds it gets a shell, not a deploy',
        });
    }
  }

  const ports = (await ssh(EXPOSED)).trim().split(NEWLINE).filter(Boolean);
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

  // Two wrong versions of this check preceded this one, in opposite directions,
  // and both are the reason it now looks like it does.
  //
  // The first grepped for "dump|backup" across cron and timers, and passed on
  // `dpkg-db-backup.timer` -- Debian's package database, not ours. Green on the
  // wrong backup.
  //
  // The second demanded postgres and pg_dump by name, but read only the
  // FILENAMES in /etc/cron.d. The real job is /etc/cron.d/hualong-backup, whose
  // name says neither word, so it cried data-loss over a backup that had run
  // every night for eight days. A false alarm about data loss burns the credit
  // the real one would need.
  //
  // So: read the contents, and follow the script the cron line names.
  const backupJob = await ssh(
    '( sudo crontab -l 2>/dev/null; sudo -u postgres crontab -l 2>/dev/null; ' +
    'sudo grep -rh . /etc/cron.d /etc/cron.daily /etc/crontab 2>/dev/null; ' +
    'systemctl list-timers --all --no-pager 2>/dev/null ) ' +
    '| grep -vi dpkg | grep -iE "pg_dump|pgdump|postgres|backup-db" || true',
  );
  if (!backupJob.trim()) {
    runReport.add({
      layer: 'vm', severity: 'high', kind: 'data-loss',
      what: 'nothing schedules a PostgreSQL dump, against CONTEXT.md line 69 which states ' +
        'a daily 05:00 pg_dump to COS with restore tested',
    });
  } else {
    runReport.add({
      layer: 'vm', severity: 'low', kind: 'coverage',
      what: 'a PostgreSQL dump is scheduled',
      detail: backupJob.trim().split(/\r?\n/).slice(0, 3),
    });
  }

  // Scheduled is not the same as running. The freshest dump on disk is the only
  // evidence that the schedule fires.
  const newest = await ssh('sudo ls -t /var/backups/hualong/*.sql.gz 2>/dev/null | head -1 || true');
  if (newest.trim()) {
    const age = await ssh(`sudo stat -c %Y "${newest.trim()}"`);
    const hours = Math.round((Date.now() / 1000 - Number(age.trim())) / 3600);
    runReport.add({
      layer: 'vm',
      severity: hours > 48 ? 'high' : 'low',
      kind: hours > 48 ? 'data-loss' : 'coverage',
      what: `newest local dump ${newest.trim().split('/').pop()} is ${hours}h old`,
    });
  }

  const disk = await ssh('df -h / | tail -1 | tr -s " " | cut -d" " -f5,2');
  runReport.add({ layer: 'vm', severity: 'low', kind: 'coverage', what: `disk: ${disk.trim()}` });
}
