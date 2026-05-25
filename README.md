![banner](./banner.png)

A cyber-noir saga from the shadows of the digital battlefield.

In a world ruled by ones and zeroes, where every login could be a lie and every email a loaded gun, The DFIR Chronicles follows a seasoned team of digital sleuths as they battle threats no firewall can stop alone.

- **Dylan Log**: the world-weary cyber-investigator haunted by past breaches.
- **Cyra Neuron**: the razor-sharp analyst with ice in her veins and logic in her blood.
- **Byte ("Bitty")**: the eccentric young forensicator who sees patterns where others see noise.

Together, they dissect malware masquerading as invoices, trace phishing trails through corporate carnage, and pull truth from tangled lines of JavaScript and shellcode. Each issue dives into real-world attack techniques, from HTML smuggling and credential harvesting to fileless intrusions and living-off-the-land exploits, retold through the lens of digital noir, where the glow of a terminal replaces the flicker of a cigarette, and the only thing sharper than a knife is a well-written grep.

Dark. Technical. Uncompromising.

The DFIR Chronicles isn't just a comic: it's incident response, with trench coats.

---

## Episodes

### 01 - The HTML Smuggling Phishing Attack

A malicious email. An innocent-looking HTML attachment. Inside, obfuscated JavaScript builds a payload designed to bypass defenses and steal credentials. The team peels back the layers of digital deception to expose a phishing campaign built on HTML Smuggling.

### 02 - The Bind Mounted Nightmare

When beaconing activity from an internal server (srv-001) to a known malicious IP is detected, the team is called in. Byte deploys a Velociraptor Offline Collector, gathering key forensic artifacts. Anomalies emerge: an unusual-hour login and a process with no associated PID, hinting at defense evasion. Volatile memory analysis reveals a suspicious binary (/tmp/lightdm) running from an odd location. Strings analysis of memory dumps uncovers the malicious domain, confirming the threat. Further investigation exposes a bind mount in /proc, used to hide the trojan (MITRE T1564.013). After cleaning the system, Byte contributes a new Velociraptor artifact to help defenders detect bind mounts.

### 03 - The Unsanitized Upload

A NIDS alert at 2 AM reveals a fourteen-minute outbound TCP session from an Apache worker on `web-prod-07` to an unknown external IP. The team traces the breach to a forgotten legacy upload endpoint with no server-side validation, through which a PHP webshell was dropped, granting the attacker code execution and a reverse shell — all within four minutes of first contact.

*(More episodes coming soon...)*
 