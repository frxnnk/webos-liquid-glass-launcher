# Colores de YouTube y HDMI

**Estado al 2026-10-21: 0.7.9 instalada; captura experimental con límites de parada documentados.**

La 0.7.8 incorpora una [reparación experimental](capture-repair.md) del capturador nativo,
Start desde captura apagada y parada completa antes de restaurar las luces. Exige la versión
nativa parcheada exacta. En esta TV ya se comprobó el estado listo para iniciar, con seis
lámparas y salida apagada. Después Manual por API detuvo PicCap y restauró 6/6 estados
exactos; Home con captura apagada devolvió Mi pantalla como foreground. El seguimiento de
video y Home con captura activa se comprobaron después, como se detalla en el checkpoint 0.7.9.
Los plazos de Start y Manual ahora son de hasta 25 s; un timeout conserva la incertidumbre.

## Checkpoint 0.7.9: parada y catálogo

El dueño confirmó que las seis luces seguían los colores de YouTube y que la imagen se veía
bien con la captura parcheada de 0.7.8. La telemetría informó UI y video activos a unos 48 FPS;
no es una medición de latencia ni de paquetes UDP por segundo.

Durante la salida activa, las seis consultas getPilot fallaron desde TV y PC. HyperHDR
informó LEDDEVICE encendido; tras apagarlo, las seis volvieron a responder. El motivo exacto
de esa falta de respuesta no quedó aislado. Un estado base outputEnabled:false cuando falla
la comprobación WiZ no demuestra que la salida física esté apagada.

La 0.7.9 valida el perfil autenticado, instancia, driver, puerto, selección de MACs, IPs
privadas únicas y regiones antes de apagar la salida propia, sin exigir respuestas WiZ
mientras ese mismo escritor está activo. START conserva la verificación viva. La compensación
de un inicio incierto aplica el mismo criterio para apagar, sin habilitar una salida nueva.

Una prueba Home con captura activa llegó a Mi pantalla y mantuvo PicCap respondiendo;
el dueño confirmó que la pantalla se veía bien. Manual detuvo la captura y apagó la salida; restauró cuatro
luces en el primer intento y conservó dos en el registro de recuperación. Reintentar Manual
restauró las dos restantes. Una lectura UDP independiente confirmó 6/6 estados originales y
el registro quedó ausente. No borres ese registro para destrabar la UI: Manual reanuda lo que
falta. La prueba terminó con captura apagada.

Esto no acredita estabilidad prolongada, standby, HDMI, contenido protegido ni que esté
resuelta la causa del incidente de pantalla negra.

## Checkpoint histórico 0.7.7

La 0.7.7 corrige la carrera entre una orden aceptada por HyperHDR y la habilitación efectiva
de `LEDDEVICE`: espera y vuelve a leer el estado dentro de un plazo acotado, sin repetir la
orden. La fachada de la TV sólo marca activa una sesión propia con salida encendida y
configuración, hardware y frames frescos verificados. Activa no equivale a lista para otro Start.
Tras Pantalla completa o Manual confirmados, el panel consulta el estado una vez; si falla,
conserva el modo confirmado, permite Manual y muestra captura sin confirmar. No hay polling.
El plazo de esos cambios es 15 s; los demás controles conservan sus tiempos anteriores.
La suite completa pasó **555/555 pruebas**. Eso no prueba todavía el botón físico de la TV.

Checkpoint de telemetría posterior al prerelease: el diagnóstico nativo devolvió `phase: active`,
`active: true`, `outputEnabled: true` y frames frescos, con YouTube en primer plano a unos
**28,5 FPS**. Dos consultas UDP independientes, separadas 3 s, encontraron las seis lámparas
encendidas; tres cambiaron RGB/brillo y las otras no variaron en ese intervalo. La sesión se
observó después de solicitar la prueba, sin activarla desde PC. Esto no atribuye una
confirmación visual al dueño ni valida escenas, latencia o Stop de 0.7.7; siguen pendientes.

## Checkpoint físico 0.7.6 desde el asistente de PC

Se reinstalaron PicCap
0.5.3 y HyperHDR Loader 22.0.1. Tras un `stop`/`start` mediante la API oficial, PicCap volvió
a informar captura de UI y video a **29,44–29,5 FPS**, con YouTube abierto por el dueño.
El perfil histórico WiZ y el acceso del servicio a su configuración privada también se
recuperaron. Brave mostró **Sincronización activa** y el dueño confirmó que las seis lámparas
siguen los colores del video de YouTube. **Desactivar restauró 6/6 lámparas**, incluidas las
dos escenas originales; una lectura independiente contrastó el resultado con el estado previo.

La activación se bloqueó antes de crear el baseline y habilitar salida: dos lámparas estaban
en la escena 6 de WiZ y no devolvían RGB. La 0.7.6 incorporó la lectura y el baseline de esos
estados y permitió la activación confirmada. Admite `sceneId` entero de **1 a 255**, como
alternativa a RGB o temperatura; **la escena 6** es el caso observado en esta TV. No conserva
custom scenes ni Rhythm. Las pruebas de 0.6.0 que siguen son históricas; el resultado actual de
parada tiene comprobación propia. Acompañar fondo conserva su alcance distinto: usa el color
de la foto del launcher, no acredita captura de YouTube.

## Recuperación y límites del checkpoint 0.7.6

- HyperHDR conservaba su base en la ubicación Qt `/home/root/.config/HyperHDR`. Se adoptó
  explícitamente el perfil histórico con las mismas seis identidades e IP comprobadas en vivo.
  Se preservaron su orden de lámparas, regiones y suavizado; no se reemplazó por un orden nuevo.
- Se respaldó el export de la base antes de generar credenciales y endurecer la autenticación.
  `apiAuth` y `localAdminAuth` quedaron activos. La preparación conservó la salida deshabilitada;
  la activación posterior pasó por la sesión con baseline antes de encenderla.
- El servicio propio se ejecutaba en una jaula con UID 6730 y no podía leer su configuración
  root `600`. Se aplicó la definición acotada hacia una copia privada del wrapper, root `0500`
  dentro de `0700`, y se confirmó el servicio relanzado con **UID 0**. El catálogo LS2 se
  recargó con el ejecutable real `/usr/sbin/ls-control`; la copia original quedó intacta.
- El almacén antiguo de sesiones pertenecía al UID de la jaula y estaba **vacío, sin baseline**.
  Se migró de forma acotada a un almacén privado root `0700`, después de verificar ese estado.
  No se usó `chown` recursivo ni se implementó una migración automática sobre sesiones pendientes.
  Un baseline existente se conserva para recuperar las lámparas; no se borra para destrabar el modo.
- Activar y los colores del video tienen confirmación del dueño. Desactivar mostró en Brave
  «Sincronización desactivada y luces restauradas» y volvió a quedar listo para activar.
  Una consulta directa al servicio y otra a `getPilot` contrastaron encendido, brillo, RGB,
  temperatura y `sceneId` contra los datos originales: **6/6 restauradas, dos en escena**.
  La comparación incorporó el `sceneId` original de las respuestas crudas; no se ignoraron
  diferencias de formato de la versión anterior. Tampoco se acredita arranque automático de
  captura tras encender la TV, HDMI o contenido protegido.

La suite completa de 0.7.6 pasó **541/541 pruebas**. El resultado en hardware y la
confirmación del dueño y la restauración independiente se documentan por separado; los tests
no prueban todos los IDs de escena admitidos ni reemplazan esas verificaciones en hardware.

La prueba histórica 0.6.0 habilitaba **Pantalla completa** solo después de comprobar configuración, atestación
física y frames frescos de PicCap. La activación y la parada se probaron físicamente el
2026-10-21 en la TV con las seis lámparas WiZ del living. No es una promesa de captura universal:
HDMI, contenido protegido, persistencia tras reinicio y el mapeo exacto de cada lámpara siguen
pendientes.

## Estado comprobado durante la prueba histórica 0.6.0

- Root persistente con HBC 0.7.3 elevado; SSH root en 22 y sshd de Developer Mode en 9922.
  PicCap 0.5.3 y HyperHDR Loader 22.0.1 instalados en la TV.
- HyperHDR configurado con el driver WiZ, la instancia `Mi pantalla WiZ Living`, seis LEDs y
  PicCap enviando flatbuffers a `127.0.0.1:19400`.
- Captura de la interfaz y de video con PicCap confirmada a unos 27–30 FPS.
- Sesión física: `LEDDEVICE` activado, seis lámparas encendidas con colores de pantalla y
  brillo 100, y después apagadas al volver a Manual.
- La primera parada devolvió `SCREEN_RESTORE_PENDING`; un segundo Manual restauró el estado.
  La recuperación pendiente no se interpreta como éxito.
- 0.6.0: 234 pruebas aprobadas y paquete verificado de 56 archivos, incluidos 17 del servicio
  (los tres adicionales son el hook de Home, no captura). SHA-256 del IPK de esta compilación:
  `0886c2610526356342e11cf532a5f4a50f0ce5be6e509cf052075d6f41be722e`.
- El modo **Acompañar fondo** de 0.5.1 sigue siendo el modo de color de la foto local; no
  acredita captura de otras apps.

## Qué comprueba Revisar captura

El botón pide `screenStatus` al pulsarlo. La 0.7.7 también hace una consulta secuencial después
de confirmar Pantalla completa o Manual. Esa lectura no cambia luces, no activa capturadores
ni habilita la salida. Abrir el panel, enfocar controles u ocultar la app no la ejecuta.

El diagnóstico comprueba:

1. HyperHDR responde, autentica el token y confirma la instancia cero.
2. El perfil y el driver WiZ coinciden con la configuración privada.
3. Las seis regiones de imagen son válidas y corresponden a las lámparas seleccionadas.
4. La salida `LEDDEVICE` no pertenece ya a otra sesión.
5. `hardwareVerified` está atestiguado en la configuración privada.
6. PicCap informa dos muestras separadas 250 ms con captura conectada, UI o video activo y
   `framerate > 0`.

Solo entonces `ready` es verdadero. Una salida ya habilitada se informa como `output-in-use` y
no se apaga ni se atribuye a esta app. Los motivos posibles incluyen `setup-pending`,
`config-invalid`, `selection-mismatch`, `profile-mismatch`, `instance-mismatch`,
`admin-required`, `hardware-unverified`, `frames-unverified`, `output-in-use`, `timeout` y
`offline`.

`hardwareVerified` es una atestación manual del dueño tras una prueba física; no la deduce el
software. Una captura que responde o un perfil correcto no demuestran imágenes actuales.

## Activación y recuperación

Antes de encender la salida, la sesión guarda el estado anterior de las seis lámparas. `start`
vuelve a comprobar la salida, exige frames frescos y atestación, activa `LEDDEVICE` y confirma el
cambio en `serverinfo`. Si falla después de encender, intenta apagarla.

Para volver a Manual, `stop` apaga `LEDDEVICE` y restaura encendido, brillo y color o blanco de
cada lámpara, confirmando cada lectura. Si alguna restauración falla, conserva la recuperación
pendiente y bloquea nuevas órdenes. Reintentar Manual reanuda solo lo que falta. Cerrar el panel
u ocultar la app no detiene la sesión por lógica de la UI.

## Configuración privada

El ejemplo público [`screen-config.example.json`](../screen-config.example.json) está
deshabilitado y no contiene credenciales. La configuración privada opcional se lee desde
`services/com.frxn.mipantalla.lights/screen-config.json`, excluido de Git. Admite `enabled`,
`token`, `profile` y `hardwareVerified`; no permite elegir otro host ni puerto. Sin configuración
o con `enabled: false` no se abre la conexión.

PicCap no es un servicio público para este rol: el servicio de la app necesita permiso de salida
hacia `org.webosbrew.piccap.service` en
`/var/luna-service2-dev/roles.d/com.frxn.mipantalla.lights.service.json`. Sin ese permiso el probe
falla cerrado y `framesVerified` queda falso. Ese archivo de rol no forma parte del IPK; si una
reinstalación lo regenera, hay que volver a aplicar el permiso.

## Qué falta probar

1. Persistencia tras reinicio: HyperHDR y PicCap siguen arrancándose manualmente.
2. HDMI y contenido protegido, por separado; un frame negro o un fallo del capturador no es un
   color válido.
3. Correspondencia física de cada región con su lámpara.
4. Latencia, carga y fluidez con seis lámparas y el ciclo de suspensión/despertar.
5. Empaquetar o documentar de forma reproducible el permiso de rol de PicCap.

La arquitectura es:

```text
Imagen de la TV → PicCap / hyperion-webos → HyperHDR local → WiZ del living
```

El driver WiZ envía brillo junto con RGB, enciende las lámparas al activarse y puede apagarlas al
detenerse; no restaura por sí solo el estado anterior. Por eso la sesión guarda y restaura el
estado. El suavizado de HyperHDR tiene su propio reloj, con mínimo de 20 Hz; no se midió todavía
su efecto con este grupo.

## Control desde el asistente del navegador

El asistente local incorpora **Revisar captura**, **Preparar captura**, **Activar** y
**Desactivar**. La conexión usa el mismo archivo de identidad SSH que las demás funciones;
el navegador no recibe el contenido de esa clave ni los tokens de HyperHDR.

- **Revisar captura** consulta el estado real. Un componente ausente se muestra como faltante;
  una conexión que no respondió queda sin confirmar. Ninguno de esos casos significa que las
  lámparas estén apagadas.
- **Preparar captura** está limitado a la LG 49UN7310PSC con firmware 04.64.00 y webOS 5.6.2.
  Instala únicamente los paquetes oficiales que faltan, con versión y SHA-256 fijados. Conserva
  instalaciones de otra versión para revisión, sin sobrescribirlas.
- **Activar** usa la sesión del servicio de Mi pantalla: guarda primero el estado de las seis
  lámparas y exige configuración, comprobación física y frames actuales antes de habilitar la
  salida. Se mantiene funcionando al pasar a YouTube.
- **Desactivar** vuelve a Manual y restaura ese estado. Si alguna lámpara no confirma, la
  recuperación queda pendiente y se puede reintentar. Perder la selección del launcher no
  impide restaurar: se usan las identidades del respaldo de la sesión.

La preparación conserva un respaldo privado del export oficial de HyperHDR y de los ajustes
anteriores antes de modificar credenciales. Genera una contraseña y guarda el token de usuario
con permisos restringidos en la TV; mantiene activada la autenticación de la API y del
administrador local. No publica esos datos en GitHub ni en la interfaz.

El servicio de luces necesita leer esa configuración privada con permisos `600`. La
preparación respalda su definición LS2 y cambia únicamente el ejecutable de
`com.frxn.mipantalla.lights` a una copia privada del wrapper de Homebrew Channel 0.7.3.
La fuente instalada se lee como datos: sus bytes deben coincidir con el hash fijado y el
inodo debe permanecer estable. La copia ejecutable queda a nombre de root, con permisos
`500`, dentro de una carpeta `700`; el ejecutable original del proveedor no se modifica ni
se usa desde la definición del servicio. No amplía sus roles ni sus permisos LS2.
Para recargar la configuración detiene
solo el proceso con el nombre, UID, ejecutable y directorio de ese servicio; el watcher de
Home queda fuera de esa selección.
Si una reinstalación regenera la definición stock del servicio, este paso debe reaplicarse.
La prueba de preparación no acredita persistencia de esa definición ni de la captura después
de un arranque en frío.

La investigación también distingue una instalación ausente de una configuración persistente:
HyperHDR puede guardar su base en `/home/root/.config/HyperHDR` cuando no existe `.hyperhdr`.
La restauración interna de nuestro perfil histórico exige su nombre exacto, las mismas seis
identidades e IP comprobadas en vivo, seis regiones válidas y la salida desactivada. Conserva
el orden, el mapeo y el suavizado anteriores; no adopta otro perfil WiZ por su tipo solamente.
Esa ruta necesita una selección explícita y deja respaldados también los ajustes de
autenticación anteriores antes de endurecer el acceso administrativo local.
La adopción no arranca un HyperHDR detenido: necesita conectarse al proceso existente para
comprobar primero su perfil y su salida. Una instalación de paquetes nueva tampoco demuestra
que la base sea nueva. El primer arranque automático de preparación solo se permite cuando
faltan ambas bases conocidas y sus rutas son seguras. Se conserva el reinicio controlado
después del import con la salida deshabilitada; el arranque automático de captura al encender
la TV sigue pendiente.

HyperHDR 22 regenera el token de usuario en cada arranque del daemon. Después del reinicio
controlado, el asistente vuelve a autenticar con la contraseña privada guardada en la TV y
persiste el token nuevo antes de actualizar el servicio. Si HyperHDR se reinicia por fuera de
esa preparación, **Revisar captura** puede informar que falta autorización. **Preparar
captura** permite renovarla cuando no hay una sesión ni una recuperación pendientes. Esto no
acredita persistencia automática entre reinicios; si existe un baseline pendiente, se conserva
para recuperar las lámparas y no se vuelve a preparar encima de él.
La publicación conserva en el registro privado el token anterior propio hasta completar el
cambio: un fallo al escribir la configuración puede reanudarse sin aceptar tokens ajenos.

La configuración del driver se importa con la API oficial `save-db`/`load-db` y se verifica
después de reiniciar HyperHDR. Esto evita cambiar el driver en caliente: HyperHDR 22.0.1 puede
encender la salida automáticamente al recibir un cambio de `device`, incluso si antes se pidió
apagarla. El perfil preparado arranca con la salida de luces deshabilitada; solo **Activar** crea
la sesión que guarda y restaura el estado de las lámparas.

Los valores iniciales son 320 × 180 píxeles y 30 FPS de captura, con suavizado a 25 Hz. Son
límites de trabajo para esta TV, no una medición de latencia ni una garantía de fluidez. La
atestación física tampoco se deduce del import: una instalación nueva sigue necesitando esa
comprobación. No se habilita el inicio automático de PicCap en esta etapa.

Los helpers de captura incluyen una compatibilidad específica con el Node 8 de esta TV. En el
preflight completo, un hijo LS2 lanzado directamente abortó; el mismo preflight funcionó al
ejecutarlo mediante un wrapper fijo `exec "$@"`. Los comandos y sus parámetros viajan como
argumentos, sin interpolarlos en código de shell. Se conservan los límites de tiempo y de
salida, y no se agregan reintentos. Los demás pasos del instalador conservan su ruta directa.
La primera lectura de las seis WiZ puede incluir el descubrimiento del servicio en frío: en la
TV superó el límite anterior de seis segundos. Esa consulta dispone de doce segundos; las
demás llamadas de preparación conservan seis, y siguen vigentes el watchdog de dieciocho
segundos y el límite SSH de veinte segundos.

## Fuentes de la preparación

- [PicCap: funcionamiento, requisitos y límites de captura](https://github.com/TBSniller/piccap#whats-this).
- [Release PicCap 0.5.3](https://github.com/TBSniller/piccap/releases/tag/0.5.3).
- [HyperHDR Loader 22.0.1 para webOS](https://github.com/webosbrew/hyperhdr-webos-loader/releases/tag/v22.0.1).
- [Driver WiZ de HyperHDR 22](https://github.com/awawa-dev/HyperHDR/blob/e5bda285227cbd38bce60da6a442dde936fd9e7a/sources/led-drivers/net/DriverNetWiz.cpp).
- [Ciclo de encendido y apagado del driver](https://github.com/awawa-dev/HyperHDR/blob/e5bda285227cbd38bce60da6a442dde936fd9e7a/sources/led-drivers/LedDevice.cpp).
- [Reporte de captura en otra placa K6LP; no acredita esta unidad](https://github.com/webosbrew/hyperion-webos/issues/55).
- [Importación oficial de la base: transacción de ajustes e instancias](https://github.com/awawa-dev/HyperHDR/blob/e5bda285227cbd38bce60da6a442dde936fd9e7a/sources/db/DBManager.cpp).
- [Reinicio del proceso después de `load-db`](https://github.com/awawa-dev/HyperHDR/blob/e5bda285227cbd38bce60da6a442dde936fd9e7a/sources/api/HyperAPI.cpp).
- [Recreación del driver al cambiar `device` en caliente](https://github.com/awawa-dev/HyperHDR/blob/e5bda285227cbd38bce60da6a442dde936fd9e7a/sources/base/HyperHdrInstance.cpp).

## Reintento de restauración y renovación de autorización (0.7.11)

**Reintento.** Al volver a Manual, `stop` escribe el estado guardado de cada lámpara. Las que no
confirman reciben **una** pasada más tras 1,5 s, con el mismo estado guardado (idempotente). Lo que
siga sin confirmar permanece en el registro de recuperación y Manual lo reanuda, como antes. El
motivo de las fallas del primer intento (UDP perdido o un último cuadro de HyperHDR) sigue sin
aislarse. Tests: 651/651. No hay prueba física: el dueño debe usar Activar y Desactivar con YouTube.
En el peor caso, con lámparas que no responden, la restauración tarda hasta el doble; el cliente
espera 25 s para Manual.

### Renovar la autorización de HyperHDR

El 22 de octubre de 2026, tras instalar 0.7.11, `screenStatus` informó `configured: true`,
`reason: "auth-required"`, sin recuperación pendiente. Un login directo con el token guardado
también falló, y el archivo `screen-config.json` era idéntico al de antes de instalar; HyperHDR
regenera su token cuando reinicia el daemon (ver arriba). **No se renovó**: la ruta del asistente
(`Preparar captura`) reimporta el perfil, reinicia HyperHDR y exige que el dueño confirme
físicamente las seis lámparas. Hasta renovarla, **Activar** no puede iniciar la captura.

### Actualizar el paquete sin perder la captura

Instalar un IPK nuevo con `appInstallService/dev/install` conserva `screen-config.json` (comprobado por
hash) pero **regenera la definición LS2 del servicio**: vuelve a `run-js-service` sin root. Hay que
restaurar la copia anterior de `/var/luna-service2-dev/services.d/com.frxn.mipantalla.lights.service`
y ejecutar `ls-control scan-services`; sin eso el servicio no arranca bajo root. Respaldos de esta
actualización: `/var/lib/mipantalla-maintenance/launcher-0711/` (incluye el IPK 0.7.10 para volver).

## Modo Auto y renovación automática (0.7.12)

### Renovación del token (verificada en la TV)

Cuando HyperHDR rechaza el token guardado (`HYPERHDR_AUTH_REQUIRED`), el servicio de luces hace **un**
login local con la contraseña que ya guarda la TV, obtiene el token vigente y lo escribe en
`credentials.json` y en `screen-config.json` (primero credenciales con `previousToken`, luego la
configuración, y al final se limpia `previousToken`). Así el asistente de PC sigue aceptando ese
estado. Solo actúa como root con archivos `600`, solo si el estado es exactamente el preparado, con un
enfriamiento de 30 s y sin reiniciar HyperHDR ni tocar su perfil. Si algo no coincide, queda
`auth-required` y se usa «Preparar captura». El login está en `hyperhdr-login.js`, separado de la lista
blanca de `hyperhdr-rpc.js`.

Comprobado el 22 de octubre de 2026: antes `reason: "auth-required"`; después `available: true`,
`ready: true`, `captureStartReady: true`, `outputEnabled: false`; ambos archivos con el mismo token,
permisos `600` y `previousToken: null`. No se inició la captura.

### Auto: cómo funciona

Es un interruptor en el panel de Luces (cuarta tarjeta). **Viene apagado.** Al activarlo, el servicio
guarda `/var/lib/mipantalla-maintenance/auto-sync/config.json` y lanza `auto-sync.js`, un proceso root
propio (no el vigilante de Home). Ese proceso se suscribe a la app en primer plano y al estado de energía
y llama al servicio de luces con `luna-send` como Mi pantalla, de modo que el servicio sigue siendo
el único dueño de la sesión de captura y de su registro de recuperación.

- **Lista permitida:** solo YouTube (`youtube.leanback.v4`). Netflix y Disney+ quedan fuera hasta
  probar el efecto del DRM en los cuadros capturados. La API no permite cambiar la lista.
- **Entrar a YouTube:** espera 3 s (para no actuar en cambios rápidos), comprueba `screenStatus` y
  recién entonces inicia Pantalla completa para las lámparas seleccionadas en `lights-config.js`.
- **Salir de YouTube o dejar Activo (reposo):** vuelve a Manual (restaura las lámparas); al salir espera 1,5 s,
  en reposo actúa de inmediato.
- **Sesión del dueño:** si Pantalla completa ya estaba activa, Auto no la toca ni la detiene.
- **Recuperación pendiente:** la reanuda con Manual antes de iniciar.
- **Fallos:** el inicio se reintenta a los 15 s y a los 30 s y se rinde hasta que salgas de la app; la
  detención se reintenta cada 5 s hasta 6 veces. Nunca hay más de una acción a la vez.
- **Apagarlo:** el proceso restaura lo que él inició y termina solo (≈3 s). Arranca de nuevo al encender
  la TV únicamente si el interruptor sigue encendido (lo lanza `home-autostart.sh`).

La tarjeta muestra Desactivado, Activado · esperando YouTube, preparando, sincronizando, sesión
manual, restaurando luces o el error. El estado vive en `state.json` (se considera vencido tras 90 s).

### Qué se probó y qué no

Probado: 699 tests (vigilante con reloj simulado, archivos privados, panel y renovación). En la TV, con el
paquete final instalado el 22 de octubre de 2026: activar Auto lanza `auto-sync.js` como root, el estado
pasa a `idle` y sigue la app en primer plano (vio `com.webos.app.hdmi1`), mantiene dos suscripciones
`luna-send` (app en primer plano y energía) y desactivar termina el proceso, cierra las suscripciones y deja
`state.json` en `off`. Todos los archivos del servicio coinciden por hash con el repositorio y
`screen-config.json` quedó idéntico. Un primer intento reveló que la suscripción usaba `luna-send -f`, cuyo
JSON multilínea el lector descartaba; ya está corregido.

**Sin probar:** que entrar a YouTube inicie la captura, que salir restaure las seis lámparas, el
comportamiento al apagar la TV con una sesión activa y la carga de CPU. Esas pruebas encienden luces reales
y la captura, por eso quedan para hacerlas con el dueño frente a la TV.

### Vista previa local

`node scripts/serve.cjs` y `http://127.0.0.1:43817/?demo=lights` abren el panel con un servicio de
luces simulado (`&auto=off|idle|waiting|syncing|stopping|error` elige el estado de Auto). Solo es
local y no está en el IPK.
