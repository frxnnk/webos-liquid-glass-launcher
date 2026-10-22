# Pantalla negra al volver de YouTube con Home

**2026-10-21 · Incidente abierto · 0.7.7 prerelease · Imagen y luces recuperadas; causa pendiente.**

Ocurrió en la LG 49UN7310PSC de referencia, con webOS 5.6.2-21 y firmware 04.64.00.
El dueño confirmó que las seis WiZ seguían los colores del video con 0.7.7. Después, al volver
de YouTube mediante Home, la pantalla quedó negra y el problema persistió tras standby.
La relación causal con la captura **no está aislada**: la secuencia temporal no basta para atribuirla.

## Observaciones durante el incidente

- El foreground quedó vacío. SAM, WAM y LS2 seguían vivos, pero lanzar Ajustes no respondió.
- Cobalt, el proceso de YouTube, se observó en estado `D`, con espera en `do_page_fault`.
  `memchute` también estaba en `D`, con espera en `m_start`. Los recorridos globales de
  `cmdline` quedaron bloqueados. Estos datos no identifican por sí solos la causa.
- Se detuvo PicCap por su API oficial y su estado detenido quedó confirmado. Su autostart
  figura en `false`. Eso no acredita que la imagen se haya recuperado.
- Durante el diagnóstico inicial, el WAL de las seis lámparas quedó guardado e intacto.
  No se borró el baseline para destrabar la sesión; la recuperación posterior se detalla abajo.
- Se solicitó **un solo** `systemctl reboot`. Tras 35 segundos no se observó una nueva uptime;
  no se considera un reinicio completado.

## Imagen recuperada y primer intento de Manual

El dueño confirmó que la imagen se recuperó después de desenchufar la TV durante 60 segundos
y volver a encenderla. Una lectura posterior mostró uptime nueva de **94,5 s** y YouTube en
primer plano. PicCap informó `isRunning: false`, UI y video detenidos y **0 FPS**. Una consulta
oficial de HyperHDR después del arranque devolvió `running: false`, `pid: 0`, `elevated: true`
y daemon `HyperHDR`: el daemon está apagado.

En ese checkpoint el WAL seguía pendiente, con seis identidades y hash idéntico al previo;
las luces aún no estaban restauradas. Se probó Manual nativo una sola vez y devolvió
`SCREEN_STOP_UNCONFIRMED`. Con el daemon apagado, la ruta normal no puede confirmar la salida;
no se atribuye ese fallo a una autorización expirada. Esto tampoco aísla la causa de la pantalla negra.

El corte de alimentación recuperó la imagen; no demuestra una corrección permanente. La causa
del bloqueo del kernel sigue sin aislar. No se hicieron nuevas pruebas de activación ni de
Home con captura después de esta recuperación.

## Recuperación offline de las seis luces

El primer intento del helper se frenó en una guardia de permisos, sin cambios. Siete archivos
propios tenían modo `0775` después del arranque. Se comprobaron sus identidades y hashes por
descriptores abiertos como root antes de ajustar sólo esos permisos: seis archivos públicos a
`0755` y la configuración a `0600`. Los bytes, el WAL y las credenciales no cambiaron durante
ese ajuste; no se hizo un cambio recursivo.

Un único reintento del mismo helper terminó en `RECOVERY_COMPLETE`: **6 confirmadas, 6 lecturas
posteriores, `pending: false`, 0 pendientes**. Usó el controlador, transporte, sesión y almacén
reales para restaurar el baseline offline, sin iniciar captura ni publicar tokens. Antes se
comprobó PicCap apagado y sin autostart, HyperHDR `running: false` con `pid: 0`, y conexión al
puerto TCP local 19444 rechazada (`ECONNREFUSED`). Esto **no valida el Stop normal**.

Una lectura UDP independiente contrastó las seis lámparas con el baseline: **6/6 estados
exactos, todas encendidas**. Antes de la recuperación ninguna coincidía. La sesión pendiente
quedó resuelta mediante esa restauración verificada, no borrando el WAL para eludirla.

## Home con captura apagada y límites pendientes

Se probó Home **una sola vez**, con PicCap e HyperHDR apagados. La orden devolvió ACK positivo;
a los 2 segundos el foreground estaba vacío durante la transición y una lectura posterior
mostró `com.frxn.mipantalla`. Las capacidades informaron modo Manual. No se midió latencia y
**falta confirmación visual del dueño de Mi pantalla**. Esto no prueba Home con captura activa.

Mientras siga abierto, no se deben repetir activaciones de captura ni añadir kills, factory
reset o sysrq. No borrar el WAL para destrabar controles. La captura de video permanece apagada.

La 0.7.7 se mantiene como **prerelease con este problema conocido**. No están acreditados la
parada normal, la estabilidad al volver con Home con captura, la latencia ni una cura permanente.
La restauración offline 6/6 y la recuperación de imagen tienen la evidencia acotada indicada;
las pruebas locales del software no acreditan esos resultados físicos ni la causalidad.
La evidencia anterior de 0.7.6 permanece como un checkpoint separado, no valida este incidente.
