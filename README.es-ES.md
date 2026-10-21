

![banner](./banner.png)

Una saga de cyber-noir desde las sombras del campo de batalla digital.

En un mundo regido por unos y ceros, donde cada inicio de sesión podría ser una mentira y cada correo electrónico un arma cargada, The DFIR Chronicles sigue a un experimentado equipo de investigadores digitales mientras combaten amenazas que ningún firewall puede detener por sí solo.

- **Dylan Log**: el investigador cibernético desgastado por la vida, atormentado por brechas del pasado.
- **Cyra Neuron**: la analista de mente afilada, con hielo en las venas y lógica en la sangre.
- **Byte ("Bitty")**: el excéntrico joven forense que distingue patrones donde otros solo ven ruido.

Juntos, diseccionan malware que se disfraza de facturas, rastrean estelas de phishing a través del caos corporativo y extraen la verdad de enredadas líneas de JavaScript y shellcode. Cada número explora técnicas de ataque reales, desde HTML smuggling y robo de credenciales hasta intrusiones sin archivos y exploits living-off-the-land, todo relatado bajo la lente del noir digital, donde el brillo de una terminal reemplaza el parpadeo de un cigarrillo, y lo único más afilado que un cuchillo es un grep bien escrito.

Oscuro. Técnico. Sin concesiones.

The DFIR Chronicles no es solo un cómic: es respuesta a incidentes, con gabardinas.

---

## Episodios

### 01 - El ataque de phishing con HTML Smuggling

Un correo electrónico malicioso. Un adjunto HTML de apariencia inocente. En su interior, JavaScript ofuscado construye una carga útil diseñada para evadir defensas y robar credenciales. El equipo despliega las capas del engaño digital para exponer una campaña de phishing basada en HTML Smuggling.

### 02 - La pesadilla de Bind Mount

Cuando se detecta actividad de beaconing desde un servidor interno (srv-001) hacia una IP maliciosa conocida, se llama al equipo. Byte despliega un Velociraptor Offline Collector, reuniendo artefactos forenses clave. Emergen anomalías: un inicio de sesión en horario inusual y un proceso sin PID asociado, que sugieren evasión de defensas. El análisis de memoria volátil revela un binario sospechoso (/tmp/lightdm) ejecutándose desde una ubicación extraña. El análisis de strings en los volcados de memoria descubre el dominio malicioso, confirmando la amenaza. Una investigación posterior expone un bind mount en /proc, utilizado para ocultar el troyano (MITRE T1564.013). Tras limpiar el sistema, Byte aporta un nuevo artefacto para Velociraptor para ayudar a los defensores a detectar bind mounts.

### 03 - La subida no sanitizada

Una alerta del NIDS a las 2 de la madrugada revela una sesión TCP saliente de catorce minutos desde un proceso worker de Apache en `web-prod-07` hacia una IP externa desconocida. El equipo rastrea la brecha hasta un punto final de subida heredado y olvidado, sin validación del lado del servidor, a través del cual se soltó un webshell en PHP, otorgando al atacante ejecución de código y un reverse shell; todo esto en apenas cuatro minutos desde el primer contacto.

### 04 - Cuatro bytes hasta root

Una alerta a las 03:14 de `non-shell parent for su` en el worker de compilación CI/CD multiinquilino `ci-worker-07` arrastra al equipo hacia un misterio a nivel de kernel. Un inicio de sesión de desarrollador robado desde una IP pública despliega un PoC en Python en `/dev/shm` que arma el `CVE-2026-31431` — "Copy Fail" — escribiendo cuatro bytes controlados en la copia en *page-cache* de `/usr/bin/su` para entregar permisos de root, mientras el binario en disco permanece idéntico byte a byte y cada verificación de integridad de archivos jura que es inofensivo. Con `dpkg -V` en silencio y `sha256sum` limpio, la única confesión proviene del árbol de procesos: un `su` cuyo padre es `python3`.

*(Más episodios próximamente...)*
