# The Bind Mounted Nightmare

## 1. Preparing the Velociraptor Offline Collector with Specified Artifacts
The process begins with building an offline collector via the official Velociraptor documentation (Offline Triage guide). The offline collector includes the following artifacts:
- `Linux.Collection.Syslogs`
- `Linux.Sys.Pslist`
- `Linux.Network.Netstat.Watcher`
- `Linux.Sockstat.Sockstat`
- `Linux.Sys.LastUserLogins`

These are legitimate Velociraptor artifacts, such as `Linux.Collection.SysLogs` for gathering system log files.

## 2. Deploying the Offline Collector
Once Alexander receives the offline collector, he applies execute permissions using `chmod +x`, and runs it on the server **srv-001**.  
- `chmod +x`: sets the executable bit on the collector binary, enabling execution.

## 3. Detecting Anomalies in User Login Logs
Byte reviews logs produced by the `Linux.Sys.LastUserLogins` artifact and identifies anomalous logins.  
- The artifact tracks recent user logins. Any deviation could indicate unauthorized access.

## 4. Identifying Suspicious Network Connections
Dylan analyzes output from `Linux.Network.Netstat.Watcher` and discovers a persistent connection to `185.118.164.195:443`.  
- A continuous connection to an external IP may signal **defense evasion**, specifically, **Hide Artifacts: Bind Mounts**, mapped to MITRE ATT&CK technique **1564.013**.  
- This reflects real-world DFIR practices: network artifacts can reveal stealthy persistence or C2 channels.

## 5. Dumping Memory Using Velociraptor Artifact
Cyra recommends performing a memory dump via the `Linux.Memory.AVML` artifact.  
- This artifact captures RAM in LiME format (`.lime`), which is suitable for memory forensics.

## 6. Setting Up Volatility3 for Memory Analysis
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

## 7. Extracting the Intermediate Symbol Format (ISF) Banner
Byte uses Volatility3 to extract the kernel banner (Intermediate Symbol Format) from the memory dump:

```bash
python3 vol.py -f ./memory.dump.lime banners.Banners
```

The banner is identified as, for example, "Linux version 6.1.0-37-amd64 (debian-kernel@lists.debian.org)...".

The Intermediate Symbol Format (ISF) is a JSON-based representation of a system's kernel symbols and data structure layouts. Volatility3 uses ISF files to interpret raw memory dumps, mapping kernel data structures to their corresponding fields and offsets. Without the correct ISF file for the kernel version in the dump, plugins cannot accurately parse process lists, network sockets, or other kernel-level information.

Volatility3 relies on the extracted banner to match the memory dump with the correct ISF file, enabling accurate forensic analysis of the memory image.

## 8. Acquiring the Corresponding Symbol Table
Byte fetches symbol information:

1. Downloads `banners_plain.json` from the Abyss‑W4tcher repository:
   ```bash
   wget https://raw.githubusercontent.com/Abyss-W4tcher/volatility3-symbols/master/banners/banners_plain.json
   ```
2. Locates the matching ISF entry via:
   ```bash
   grep -A 2 'Linux version 6.1.0-37-amd64 (debian‑kernel@lists.debian.org)...' banners_plain.json
   ```
3. Downloads the appropriate ISF `.json.xz` into Volatility3’s `symbols/linux/` directory.

This matches established practice: using Abyss‑W4tcher’s central repo of pre-built ISF files for memory analysis.

## 9. Inspecting Memory for ELF Binaries
Byte runs this command to detect ELF binaries in memory:

```bash
python3 vol.py -f memory.dump.lime linux.elfs.Elfs
```

The plugin reveals an ELF file located in `/tmp/lightdm`, which is unusual and may indicate malicious payload presence.

## 10. Dumping Memory Region of a Suspicious Process
To investigate further, Byte extracts the memory mapping for a process and dumps it:

```bash
python3 vol.py -f ../memory.dump.lime -o /tmp/test linux.proc.Maps --pid 5016 --dump
```

Options explained:
- `--pid 5016`: target process ID
- `--dump`: instructs the plugin to dump the mapped memory region
- `-o /tmp/test`: output directory for the dumped files

This enables focused forensic inspection of the suspect process.

## 11. Searching for Known C2 Indicators in Dumps
Byte searches for the domain string in dumped files:

```bash
grep -Rail e36f249c-8e3a.ddns.net *.dmp
```

- `grep -R`: recursive search
- `-a`: treat binary files as text
- `-i`: case-insensitive
- `-l`: list filenames containing a match

The domain matches, suggesting contact with a known C2 server.

## 12. Confirming Network Connection via Memory
Byte runs:

```bash
python3 vol.py -f ../memory.dump.lime linux.sockstat.Sockstat
```

This plugin reveals socket states held in memory, confirming the connection to the previously observed IP/domain—supporting the initial defense evasion hypothesis.

## 13. Verifying Bind Mount Defense Evasion
Finally, Byte executes:

```bash
python3 vol.py -f ../memory.dump.lime Linux.mountinfo.MountInfo
```

This displays mount points, confirming that a **bind mount** was used to hide artifacts—consistent with the "Hide Artifacts: Bind Mounts" technique observed in the network artifacts.
