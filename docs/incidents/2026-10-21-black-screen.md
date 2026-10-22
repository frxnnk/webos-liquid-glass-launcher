# Pantalla negra al volver de YouTube con Home

**2026-10-21 · Incidente abierto · 0.7.7 prerelease · Recuperación visual pendiente.**

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
- El WAL de la sesión de las seis lámparas sigue guardado e intacto. No se borró el baseline
  ni se dio por restaurada la iluminación de esta sesión.
- Se solicitó **un solo** `systemctl reboot`. Tras 35 segundos no se observó una nueva uptime;
  no se considera un reinicio completado.

## Recuperación solicitada y límites

Se pidió al dueño desenchufar la TV durante 60 segundos y volver a encenderla. **Falta su
confirmación visual del resultado.** Es una medida física de recuperación, no una solución
demostrada ni una prueba de que el incidente no vuelva a ocurrir.

Mientras siga abierto, no se deben repetir activaciones de captura ni añadir kills, factory
reset o sysrq. No borrar el WAL para destrabar controles. Manual y Acompañar fondo sólo se
evaluarán después de confirmar la recuperación y revisar el estado pendiente de las luces.

La 0.7.7 se mantiene como **prerelease con este problema conocido**. No están acreditados la
parada/restauración de esta sesión, la estabilidad al volver con Home, la latencia ni una cura
permanente. Las pruebas locales del software no prueban recuperación de la TV ni causalidad.
La evidencia anterior de 0.7.6 permanece como un checkpoint separado, no valida este incidente.
