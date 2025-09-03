In this story, the detection of a trojan installed on a target server will be addressed. To remain undetectable during analysis, the attackers used a technique known as Bind Mount (Hide Artifacts: Bind Mounts - T1564.013).

* Alexander, SoC Manager of a well-known company, contacts Dylan Log. Alexander reports that the perimeter protection systems have detected beaconing activity from an internal server (hostname: srv-001). The contacted IP address belongs to a known malicious server (IP: 185.118.164.195, associated Dynamic DNS: e36f249c-8e3a.ddns.net).
* Byte suggests sending a Velociraptor Offline Collector to be run on the compromised server. The offline collector will contain the following artifacts: Linux.Collection.Syslogs, Linux.Sys.Pslist, Linux.Network.Netstat.Watcher, Linux.Sockstat.Sockstat and Linux.Sys.LastUserLogins. The package is sent to Alexander.
* Byte detects an unusual-hour login via the administrative account authority.
* Analyzing the results of the Linux.Network.Netstat.Watcher artifact, Byte identifies a running process with no associated PID; this represents a clear attempt at Defense Evasion.
* Convinced of this hypothesis, Cyra suggests conducting volatile memory analysis using the Linux.Memory.AVML artifact.
* After receiving the memory dump, Byte proceeds to analyze it using Volatility3.
* Byte uses the linux.elfs.Elfs plugin, detecting an unusual execution of a binary file /tmp/lightdm. The binary file name is located in an unusual location.
* Byte extracts the volatile memory allocated to the process using the linux.proc.Maps plugin. Afterwards, Byte runs the strings command on all the extracted *.dmp files and finds the malicious domain reported by Alexander, the SoC Manager.
* To be 100% sure of the hypothesis, Byte analyzes the logs from the Linux.Sockstat.Sockstat artifact and confirms the presence of a process communicating with the IP address associated with the malicious domain.
* Analyzing the overall situation and the data collected so far, Byte suspects that MITRE technique T1564.013 was used to hide the trojan. For this reason, Byte decides to use the Volatility 3 plugin Linux.mountinfo.MountInfo.
* Byte confirms the hypothesis: the reserved folder within the /proc directory had been mounted on a tmpfs file system.
* After removing the malicious software, Byte decides to contribute to the Velociraptor community with a new artifact to detect Bind Mounts: Linux.Mounts.ProcBindMount.