# Root, botón Home e inicio automático

Estado al 21 de octubre de 2026: root y HBC 0.7.3 quedaron **persistentes** en la TV; el arranque
en frío se verificó con SSH root en el puerto 22, sshd de Developer Mode en 9922 y el hook de
Home ejecutando Mi pantalla. El dueño confirmó previamente que la tecla física Home abre la app;
falta revalidar foco y repetición en la versión actual. En 0.7.0 confirmó buena navegación, pero
al apagar 20 s con el control y encender **Mi pantalla no abrió sola**. Ese caso de standby falló.
El dueño confirmó físicamente en 0.7.1 que ahora abre sola tras apagar 20 s con el control, y que
Home desde YouTube termina en Mi pantalla tras esperar 2 s. Root y HBC ya están hechos: no se repite su proceso.
Se retiraron tres apps removibles de LG; otras apps y servicios del sistema se conservaron.

Mi pantalla sigue siendo una aplicación de webOS y no reemplaza el firmware ni los menús
internos. Desde 0.7.2, `general.defaultApps.home` la selecciona como destino nativo de Home;
el Home de LG se conserva para recuperación. El detector de teclas de la fase 1 es histórico:
el watcher actual usa `--native-home`, sin polling de input, y mantiene boot y power/wake.

La lectura actual confirmó `general.homePromotion: off` y `option.livePlus`, `livePromotion`
y `webOSPromotionVideo: off`, además de los ajustes publicitarios detallados en limpieza.
`homeAutoLaunch` volvió a `on` sin causa aislada: no se presenta como desactivado actualmente.
Se conservaron Quick Start y las apps de recuperación. [Cambios y reversión](cleaning.md).
La app actual es 0.7.7; el estado de pruebas por versión está en el [README](../README.md).

## Qué se revisó y qué se ejecutó

Se leyeron código, scripts e invocaciones de SlopBro, Homebrew Channel y webOS Launch Home. SlopBro
se usó para obtener root; HBC se instaló, se elevó y se comprobó en un arranque en frío. La
integración de Home es propia y acotada: no se instalaron los scripts de Launch Home.

| Proyecto | Fuente fijada | Alcance |
| --- | --- | --- |
| SlopBro | [`21023d56ca424607bb03d2939609cc658c655fc7`](https://github.com/throwaway96/slopbro/tree/21023d56ca424607bb03d2939609cc658c655fc7) | Cliente, servidor local, página, servicio y script de instalación/elevación. |
| Homebrew Channel 0.7.3 | [`92fcf9fef7ce08dbeae3b0616df8d0c75c11f0b3`](https://github.com/webosbrew/webos-homebrew-channel/tree/92fcf9fef7ce08dbeae3b0616df8d0c75c11f0b3) | Elevación, startup, actividad persistente, servicio y frontend relevante. |
| webOS Launch Home | [`dc33d92743830a4df0299e3d898705dbe9b7feae`](https://github.com/gprot42/webos-launch-home/tree/dc33d92743830a4df0299e3d898705dbe9b7feae) | Referencia de watcher y arranque; no se instaló. |

El IPK oficial de HBC 0.7.3 coincidió con el SHA-256 publicado por GitHub:

`d10bf3c753551d7c72fb7a92b20fcd2317e502a220ac668ba8e76f6ea78b363c`

Sus scripts de startup, jumpstart y ejecución del servicio coincidieron con la fuente revisada. No
se reconstruyeron los binarios ARM ni se verificó reproducibilidad de todo el paquete.

## Adaptador experimental del asistente local

El [asistente para Brave](local-installer.md) ya incluye un adaptador de root implementado para
**49UN7310PSC / 04.64.00 / webOS 5.6.2-21 / `jhericurl-jimna` / K6LP_ATSC_BR**. Es una cadena
nueva, separada del procedimiento histórico de esta página. El diagnóstico y el plan reales en
la TV actual verificaron root existente y **omitieron el bootstrap**; no se volvió a rootear.

El código comprueba el perfil y Developer Mode, fija fuentes y hashes, prepara un bootstrap
propio con acceso temporal por clave, respalda antes de provisionar HBC y comprueba los accesos
posteriores. Conserva el script firmado y el token regular de Developer Mode. La reparación
automática de un script alterado o ausente exige un backup con firma LG y hash stock válidos;
no inventa ni reemplaza el token. Una reserva exclusiva por IP evita ejecuciones paralelas y
conserva las operaciones inciertas para revisión.

**No se probó la cadena completa partiendo de una TV original.** Falta integrar la primera
confianza de huellas SSH desde la UI y comprobar físicamente el startup de este flujo nuevo.
El adaptador no acepta huellas a ciegas, no hace downgrade ni reinicia automáticamente la TV.
Sus pruebas locales no heredan el arranque físico confirmado con el procedimiento anterior.
El navegador requiere el programa local de PC y SSH; aplicar el bootstrap también requiere
Python 3.8+. [Flujo, respaldos y límites exactos](root-automation.md).

La clave que permite entrar como root puede no estar autorizada para el usuario `prisoner` de
Developer Mode. En ese caso el asistente deja el login de 9922 **sin confirmar**, mientras puede
verificar firma y token desde root. No presenta ese fallo de autenticación como Developer Mode apagado.

## Reparación de Developer Mode

Durante la recuperación se encontró que el `start-devmode.sh` stock había sido parcheado y su
firma ya no verificaba. Se restauró el original desde el backup, se comprobó la firma con
`pub.pem` y se recreó `/var/luna/preferences/devmode_enabled` a partir del token de sesión
descargado. El `start-devmode.sh` actual tiene SHA-256:

`18b6b7cce77d640fef78d9d247d6fc672b0850bd728dd2a3c44105a485abc846`

No se vuelve a parchear ese archivo: la firma es lo que mantiene Developer Mode. `/media/developer`
está en una partición ext4 persistente; las apps de desarrollo sobreviven al reinicio mientras
Developer Mode siga activo. Si Developer Mode se desactiva, el sistema puede borrar ese directorio:
no es una falla del hook.

Las apps HBC y Mi Pantalla se instalaron desde IPK con hashes verificados. Cuando
`appinstalld` arranca sin Developer Mode, `/dev/install` puede responder
`Unknown method "install" for category "/dev"`; `systemctl restart appinstalld` lo resuelve sin
parchear archivos ni firmas.

## Home e inicio automático

La fase 1 usa un watcher propio sobre `/dev/input/event*`, sin registrar otro servicio Luna ni
modificar roles. HBC ejecuta un symlink de `/var/lib/webosbrew/init.d/` al script del servicio.
En el arranque en frío del 2026-10-21:

- HBC ejecutó el hook y quedó un solo `home-watch.js --boot --watch --poll-ms=100`.
- El watcher abrió 9 dispositivos y registró `boot: accepted`.
- Mi pantalla quedó en primer plano y accesible por CDP; se midieron 60,29 FPS.
- El consumo del watcher fue de alrededor de 4,4 % de CPU en reposo.

La 0.7.0 quedó instalada, con apertura por `ares-launch` y `boot: accepted` del watcher;
pasaron 243 pruebas y se verificaron 56 archivos, 17 del servicio. Esos ACK no sustituyen una
comprobación de visibilidad ni un encendido físico. Una muestra CDP real a 1920×1080 con
Chromium 68 registró 209 intervalos (p95 16,666 ms); el dueño confirmó que navega bien.
Los halos y el foco se optimizaron solo para TV, conservando vidrio estático, fotos, fundido y clima.
El watcher comparte un lanzamiento entre boot/Home/wake, evita acumular falsos gaps, reintenta
wake solo tras fallo y cancela ante ACK; polling por defecto de 100 ms. No basta un gap de CPU
para acreditar un ciclo de encendido con Quick Start.

La 0.7.1 quedó instalada por CLI: 254 pruebas, 57 archivos y 18 del servicio; SHA-256
`1331e3b7f0684125708544489cab9c0171bf6030421c8250f2b6c5593289045b`.
En la comprobación quedó el watcher PID 13691 con `boot: accepted` y un hijo `luna-send`
suscrito a `getPowerState`, esperado como monitor. `home-power.js` usa no activo → `Active`,
toma el primer `Active` como base y reconecta a los 5 s; mientras está listo, inhibe el fallback
por gap. El dueño confirmó físicamente que, tras apagar 20 s con el control y encender, abre sola.
Home añade logs fijos de aceptación/rechazo; desde YouTube el dueño confirmó que, tras esperar
2 s después de Home, termina en Mi pantalla. La navegación fluida confirmada corresponde a 0.7.

Home tiene confirmación física previa. El foco posterior, Home repetido/mantenido, el standby
corto/largo y otras variantes de Quick Start+ necesitan comprobaciones específicas. Apagar 20 s
con el control falló en 0.7.0 y quedó confirmado en 0.7.1, al igual que Home desde YouTube tras 2 s.
El procedimiento de prueba, el código 773 y el rollback están en
[Home e inicio automático](home-takeover.md).

## Hallazgos de seguridad y persistencia

- HBC 0.7.3 abre Telnet root sin autenticación por defecto. El flag normal para deshabilitarlo no
  se consulta en la rama failsafe, que también abre Telnet. En esta instalación se creó
  `/var/luna/preferences/webosbrew_telnet_disabled` y se verificó el puerto 23 cerrado tras el
  arranque. Mantener esa comprobación después de reinstalar HBC.
- HBC usa Dropbear sin deshabilitar explícitamente las contraseñas. Se configuró una clave
  autorizada y se comprobó el acceso root; conservar la clave y el backup de recuperación.
- La elevación modifica configuración y permisos LS2 de HBC y habilita un servicio con ejecución
  root amplia. HBC además registra una actividad persistente para ejecutar su startup y los hooks
  de usuario. Es un cambio de privilegios del dispositivo, con alcance mayor que la interfaz.
  [Elevación](https://github.com/webosbrew/webos-homebrew-channel/blob/92fcf9fef7ce08dbeae3b0616df8d0c75c11f0b3/services/elevate-service.ts),
  [servicio y autostart](https://github.com/webosbrew/webos-homebrew-channel/blob/92fcf9fef7ce08dbeae3b0616df8d0c75c11f0b3/services/service.ts).
- SlopBro descarga HBC sin comprobar su hash. Cambia el estado persistente de Developer Mode y
  puede renombrar su script de inicio de LG si falla la verificación. No conserva todos los
  originales ni implementa rollback transaccional.
  [Autoroot revisado](https://github.com/throwaway96/slopbro/blob/21023d56ca424607bb03d2939609cc658c655fc7/wwwroot/autoroot.sh).
- El cliente de SlopBro desactiva la verificación del certificado WSS y entrega el payload por
  HTTP. Su mensaje final solo confirma solicitudes de archivos; no confirma root, instalación ni
  persistencia. [Cliente revisado](https://github.com/throwaway96/slopbro/blob/21023d56ca424607bb03d2939609cc658c655fc7/slopbro.py).
- El failsafe de HBC omite personalizaciones y hooks durante ese startup, pero no deshace la
  instalación o elevación. No se verificó un procedimiento completo de unroot para este hardware.

## Recuperación y pendientes

Conservar: acceso SSH root, clave autorizada, backup del estado de la TV y el IPK de HBC. Antes de
cambiar el hook, retirar solo el symlink y validar el PID del watcher; el rollback está en
[Home e inicio automático](home-takeover.md). Desinstalar el IPK no retira el hook.

Siguen pendientes:

1. Comprobar Home desde otras apps, foco y repetición; YouTube → Home ya termina en Mi pantalla tras 2 s.
2. Otros ciclos de standby y Quick Start+; el encendido tras apagar 20 s con el control ya está confirmado.
3. Persistencia de Pantalla completa tras reinicio; HDMI y contenido protegido.
4. Una prueba de desactivación completa de Home y, si se decide, de unroot.
5. Acreditar el [adaptador experimental](root-automation.md) desde una TV original, incluida
   confianza inicial SSH y arranque físico, sin repetirlo sobre la TV ya rooteada.
