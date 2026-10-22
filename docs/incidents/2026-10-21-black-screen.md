# Pantalla negra al volver de YouTube con Home

**2026-10-21 · Incidente abierto · 0.7.7 prerelease · Imagen y luces recuperadas; causa pendiente.**

Actualización: se instaló la [candidata experimental 0.7.8](../capture-repair.md), con un
parche nativo probado fuera de la TV y captura apagada. Se verificó la preparación en esta
unidad, pero la nueva secuencia video → Manual → Home sigue pendiente. El incidente no se
considera cerrado ni se atribuye su causa al defecto local sin prueba adicional.

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
mostró `com.frxn.mipantalla`. Las capacidades informaron modo Manual. El dueño confirmó
**que Mi pantalla se ve bien después de esta prueba**. No se midió latencia y esto no prueba
Home con captura activa.

Durante la recuperación no se repitieron activaciones ni se añadieron kills, factory reset
o sysrq. No borrar el WAL para destrabar controles. La captura de video permanece apagada;
una prueba nueva pertenece a la candidata revisada, no a una repetición de 0.7.7 sin cambios.

La 0.7.7 se mantiene como **prerelease con este problema conocido**. No están acreditados la
parada normal, la estabilidad al volver con Home con captura, la latencia ni una cura permanente.
La restauración offline 6/6 y la recuperación de imagen tienen la evidencia acotada indicada;
las pruebas locales del software no acreditan esos resultados físicos ni la causalidad.
La evidencia anterior de 0.7.6 permanece como un checkpoint separado, no valida este incidente.

## Revisión posterior sin reactivar la captura

La integración actual de Manual detiene `LEDDEVICE` y restaura las lámparas, pero no llama a
`PicCap.stop`. El cambio de visibilidad de Mi pantalla pausa el modo fondo, no la captura
nativa. Es un problema concreto de gestión del ciclo de captura, aunque no demuestra la
causa del bloqueo. Home nativo define el destino de apertura; no se encontró un gancho previo
acreditado que permita detener PicCap antes de salir de YouTube con el botón físico.

El backend incluido en PicCap 0.5.3 corresponde a `00c932f`. Su
[hilo de sincronización](https://github.com/webosbrew/hyperion-webos/blob/00c932f092084b234b3f619b060a98fa134c12bd/unicapture/unicapture.c)
puede terminar la captura de video mientras el otro hilo consume cuadros; el
[backend VTC](https://github.com/webosbrew/hyperion-webos/blob/00c932f092084b234b3f619b060a98fa134c12bd/unicapture/backends/libvtcapture.cpp)
entrega punteros a buffers del driver. Esto plantea una hipótesis de concurrencia al cambiar
de superficie, sin identificar la causa de esta TV. Los registros guardados no confirman
que esa ruta se haya ejecutado antes del bloqueo.

No se cambiaron backends, quirks ni ajustes de la TV durante esta revisión. Separar captura
de video y GUI o gestionar una parada completa son posibilidades que requieren pruebas;
ninguna se presenta como solución verificada ni habilita volver a activar la captura.
