---
title: The Bind Mounted Nightmare
number: 2
released: 2025-09-03
pages: 15

cover: assets/covers/the-bind-mounted-nightmare.jpg
pdf: assets/pdf/DFIR_Chronicles_The_Bind_Mounted_Nightmare.pdf

host: srv-001
techniques: [T1564.013]
tags: [Linux, Memory forensics, Defense evasion]

# The SIEM line that opened the case. Feeds the SOC ticker on the home page.
alert: beaconing from srv-001 to 185.118.164.195 — active process, no PID

# One line for the card and the billboard.
hook: >-
  The process is beaconing. The process has no PID. Something in /proc is
  lying, and the lie is mounted on top of the truth.
---

# The Bind Mounted Nightmare

## Back cover

In this episode of The DFIR Chronicles, cyber-investigator Dylan Log, analyst Cyra Neuron, and forensic prodigy Byte are thrust into a high-stakes hunt for a trojan that refuses to be seen.

When SoC Manager Alexander reports strange beaconing from an internal server, the team uncovers connections to a known malicious IP. But the signs don't add up; the process is active, yet no PID exists. It's a phantom in the system.

Armed with a Velociraptor Offline Collector, they sift through system logs, netstat outputs, and memory dumps. What they find is chilling: a rogue binary buried in `/tmp`, communicating with a command-and-control server, masked behind a sophisticated bind mount (MITRE ATT&CK T1564.013) that hides it from prying eyes.

As Dylan connects the operational dots, Cyra pushes volatile memory analysis to its limits, and Byte crafts a brand-new detection artifact, the team races against time to expose the trojan's hiding place before it slips away for good.

In the shadows of the Linux `/proc` filesystem, the truth lies buried under layers of deception and in The DFIR Chronicles, the only way to win is to see what the attacker never wanted you to find.

## Technical note

### 1. Preparing the Velociraptor Offline Collector with Specified Artifacts

The process begins with building an offline collector via the official Velociraptor documentation (Offline Triage guide). The offline collector includes the following artifacts:
- `Linux.Collection.Syslogs`
- `Linux.Sys.Pslist`
- `Linux.Network.Netstat.Watcher`
- `Linux.Sockstat.Sockstat`
- `Linux.Sys.LastUserLogins`

These are legitimate Velociraptor artifacts, such as `Linux.Collection.SysLogs` for gathering system log files.

### 2. Deploying the Offline Collector

Once Alexander receives the offline collector, he applies execute permivssions using `chmod +x`, and runs it on the server **srv-001**.  
- `chmod +x`: sets the executable bit on the collector binary, enabling execution.

### 3. Detecting Anomalies in User Login Logs

Byte reviews logs produced by the `Linux.Sys.LastUserLogins` artifact and identifies anomalous logins.  
- The artifact tracks recent user logins. Any deviation could indicate unauthorized access.

### 4. Identifying Suspicious Network Connections

Dylan analyzes output from **Linux.Network.Netstat.Watcher** and discovers a persistent connection to **185.118.164.195:443**.

Further investigation shows that the process responsible for this connection does not have a visible PID in the standard process listings. This strongly suggests the use of a **bind mount** to hide the `/proc/<PID>` directory from user-space tools, making the process invisible during normal inspection.

This is a clear instance of defense evasion through the technique **Hide Artifacts: Bind Mounts**, mapped to **MITRE ATT&CK T1564.013**.

Such techniques are commonly used by attackers to conceal malicious processes while maintaining active communication with a Command and Control (C2) server.

### 5. Dumping Memory Using Velociraptor Artifact

Cyra recommends performing a memory dump via the `Linux.Memory.AVML` artifact. 

- This artifact captures RAM in LiME format (`.lime`), which is suitable for memory forensics.

### 6. Setting Up Volatility3 for Memory Analysis

Byte sets up Volatility3 to analyze the memory dump, following these steps:

```bash
# Clone the repository and enter directory
git clone https://github.com/volatilityfoundation/volatility3.git && cd volatility3

# Create and activate a Python virtual environment
python3 -m venv venv && . venv/bin/activate

# Install Volatility3 with development dependencies
pip install -e ".[dev]"
```

These commands are standard for installation and environment setup.

### 7. Extracting the Intermediate Symbol Format (ISF) Banner

Byte uses Volatility3 to extract the kernel banner (Intermediate Symbol Format) from the memory dump:

```bash
python3 vol.py -f ./memory.dump.lime banners.Banners
```

The banner is identified as, for example, `"Linux version 6.1.0-37-amd64 (debian-kernel@lists.debian.org)..."`.

The Intermediate Symbol Format (ISF) is a JSON-based representation of a system's kernel symbols and data structure layouts. Volatility3 uses ISF files to interpret raw memory dumps, mapping kernel data structures to their corresponding fields and offsets. Without the correct ISF file for the kernel version in the dump, plugins cannot accurately parse process lists, network sockets, or other kernel-level information.

Volatility3 relies on the extracted banner to match the memory dump with the correct ISF file, enabling accurate forensic analysis of the memory image.

### 8. Acquiring the Corresponding Symbol Table

Byte fetches symbol information:

1. Downloads `banners_plain.json` from the Abyss‑W4tcher repository:
   ```bash
   wget https://raw.githubusercontent.com/Abyss-W4tcher/volatility3-symbols/master/banners/banners_plain.json
   ```
2. Locates the matching ISF entry via:
   ```bash
   grep -A 2 'Linux version 6.1.0-37-amd64 (debian‑kernel@lists.debian.org)...' banners_plain.json
   ```
3. Downloads the appropriate ISF `.json.xz` into Volatility3's `symbols/linux/` directory.

This matches established practice: using Abyss‑W4tcher's central repo of pre-built ISF files for memory analysis.

### 9. Inspecting Memory for ELF Binaries

Byte runs this command to detect ELF binaries in memory:

```bash
python3 vol.py -f memory.dump.lime linux.elfs.Elfs
```

The plugin reveals an ELF file located in `/tmp/lightdm`, which is unusual and may indicate malicious payload presence.

### 10. Dumping Memory Region of a Suspicious Process

To investigate further, Byte extracts the memory mapping for a process and dumps it:

```bash
python3 vol.py -f ../memory.dump.lime -o /tmp/dump linux.proc.Maps --pid 5016 --dump
```

Options explained:

- `--pid 5016`: target process ID
- `--dump`: instructs the plugin to dump the mapped memory region
- `-o /tmp/dump`: output directory for the dumped files

This enables focused forensic inspection of the suspect process.

### 11. Searching for Known C2 Indicators in Dumps

Byte searches for the domain string in dumped files:

```bash
grep -Rail e36f249c-8e3a.ddns.net *.dmp
```

- `grep -R`: recursive search
- `-a`: treat binary files as text
- `-i`: case-insensitive
- `-l`: list filenames containing a match

The domain matches, suggesting contact with a known C2 server.

### 12. Confirming Network Connection via Memory

Byte runs:

```bash
python3 vol.py -f ../memory.dump.lime linux.sockstat.Sockstat
```

This plugin reveals socket states held in memory, confirming the connection to the previously observed IP/domain, this supporting the initial defense evasion hypothesis.

### 13. Verifying Bind Mount Defense Evasion

Finally, Byte executes:

```bash
python3 vol.py -f ../memory.dump.lime Linux.mountinfo.MountInfo
```

This displays mount points, confirming that a **bind mount** was used to hide artifacts—consistent with the "Hide Artifacts: Bind Mounts" technique observed in the network artifacts.
