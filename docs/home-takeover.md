# Home nativo e inicio automático

Implementación para LG webOS 5.6.2 y `com.frxn.mipantalla`. Estado al 2026-10-21: **arranque
automático y watcher verificados en la TV, incluido un arranque en frío**. El dueño confirmó que
pulsar Home abre Mi pantalla; falta revalidar foco y Home repetido/mantenido en la versión actual.
La 0.7.0 quedó instalada y el dueño confirmó buena navegación. Al apagar 20 s con el control y
encender, **Mi pantalla no abrió sola**. En 0.7.1 el dueño confirmó físicamente que **ahora abre sola**
en ese caso y que, desde YouTube, Home termina **en Mi pantalla tras esperar 2 s**.
El Home nativo se introdujo en **0.7.2** y se conserva en **0.7.5**, instalada. HOME por entrada de red desde YouTube
terminó en nuestra app, sin un nuevo `home: detected`; esa prueba solo acredita destino. Después
el dueño confirmó **Home físico desde YouTube y encendido tras apagar 20 s directamente en Mi
pantalla, sin LG primero en esos dos casos**. No se extiende a cold boot nuevo, foco o repetición.

## Estado verificado

- Evidencia anterior, IPK 0.6.0 recompilado con los tres archivos de Home: **56 archivos**, **17 del servicio**.
  SHA-256: `0886c2610526356342e11cf532a5f4a50f0ce5be6e509cf052075d6f41be722e`.
- Instalado en la TV; `/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights/`
  contiene `home-autostart.sh`, `home-input.js` y `home-watch.js`.
- HBC 0.7.3 elevado, SSH root en el puerto 22 y sshd de Developer Mode en 9922. El hook
  `/var/lib/webosbrew/init.d/60-mipantalla-home` apunta a `home-autostart.sh`.
- Arranque en frío del 2026-10-21 06:20: HBC ejecutó el hook; quedó un solo watcher
  (`home-watch.js --boot --watch --poll-ms=100`), abrió 9 dispositivos de entrada y registró
  `boot: accepted`; Mi pantalla quedó en primer plano y accesible por CDP en 9998.
- Con la app en primer plano: **60,29 FPS** medidos con `requestAnimationFrame` durante 3 s a
  1920x1080. El watcher consumió alrededor de **4,4 % de CPU** en reposo; no se observó un
  segundo proceso ni un bucle de lanzamientos.
- El arranque en frío anterior, con el IPK sin los archivos de Home, no ejecutó el hook. Esa
  diferencia fue de empaquetado, no de HBC; desde 0.6.0 se incluyen los tres archivos.
- IPK **0.7.0**: **243 pruebas**, **56 archivos**, **17 del servicio**. Instalación y apertura por
  `ares-launch` aceptadas; el watcher registró `boot: accepted`. SHA-256:
  `0e8f831ad05993c56aade1792e920677ced1e173273058c8bd32803feb9393f3`.
- IPK **0.7.1**: **254 pruebas**, **57 archivos**, **18 del servicio**, instalación CLI aceptada.
  Watcher PID `13691` con `boot: accepted`; su hijo `luna-send` suscrito a `getPowerState` es esperado.
  SHA-256: `1331e3b7f0684125708544489cab9c0171bf6030421c8250f2b6c5593289045b`.
- IPK **0.7.2** instalado: **257 pruebas**, **57 archivos**, **18 del servicio**, **1.690.292 bytes**.
  SHA-256: `61a3deb0458378b0885d65df6d64390e1f8f07b1264fe722aa21add2a22303b7`.

La navegación 0.7.0 se midió por CDP en esta TV real, Chromium 68 a 1920×1080, con flechas cada
120 ms durante 3,5 s: 209 intervalos, media 16,7457 ms, p95 16,666 ms, máximo 33,332 ms y uno
mayor de 25 ms; p95 del handler 13,7 ms. Es una muestra acotada, no una prueba con control físico
ni una garantía universal. El dueño confirmó después que la navegación responde bien.
Se optimizaron halos de pantalla completa y transiciones de foco instantáneas solo en TV;
se conservan vidrio estático, fotos, fundido y clima.

La pulsación física de Home tiene confirmación previa del dueño. Falta revalidar el regreso de
foco, Home repetido/mantenido y varias apps en la versión actual. El retorno tras apagar 20 s
con el control falló en 0.7.0; standby corto/largo, Quick Start+ y desinstalación completa no están
validados en general. En 0.7.1 el dueño confirmó encendido tras apagar 20 s con el control y Home
desde YouTube con destino final Mi pantalla tras 2 s. No acredita ausencia de una aparición inicial
del Home de LG. El ACK de boot por sí solo no prueba app visible.
Las preferencias de promociones/Home y las tres apps LG retiradas constan en [limpieza](cleaning.md).

## Home nativo: configuración 0.7.2

`general.defaultApps.home` cambió de `com.webos.app.fullhome` a `com.frxn.mipantalla`, preservando las demás
entradas de `defaultApps`. La metadata de esta TV usa `valueCheck: false`; se revisaron la
suscripción del compositor en `StarfishViewStateController.qml:74`, `StarfishKeyFilter.qml:782` y
`systemUi.js` (`launchHomeApp`). Es evidencia del mecanismo en esta TV, no garantía entre modelos.
`homeAutoLaunch` se reaplicó en `off` y se confirmó por lectura; después volvió a leerse `on`.
El estado final es `on`, sin causa aislada; el default Home propio sigue intacto y ambos casos
físicos funcionaron con esa lectura. No se sigue cambiando esa preferencia.
El marcador `/var/lib/mipantalla-maintenance/native-home/enabled` activa `--native-home` en el
watcher: omite discovery, descriptores y polling de input; conserva boot, potencia y wake.
El modo de input anterior sigue siendo fallback y usa 100 ms por defecto, pero no está activo
con ese marcador. El hijo `luna-send` de potencia es esperado y no es otro watcher.

La prueba de HOME enviada por entrada de red desde YouTube terminó en `com.frxn.mipantalla`
sin un nuevo log `home: detected`. La observación de primer plano solo prueba destino final;
no mide latencia ni descarta una aparición del Home de LG. Las confirmaciones físicas de 0.7.1
son históricas. En 0.7.2 el dueño confirmó Home desde YouTube y encendido tras apagar 20 s
directos a Mi pantalla, sin LG primero en esos casos. No se midió latencia ni se validaron otros ciclos.

## Arquitectura

Los cuatro archivos de Home se empaquetan junto al servicio de luces, pero el watcher es un proceso root
independiente. No usa `webos-service`, no registra otro servicio Luna ni cambia el registro o el
comportamiento del servicio de luces.

- `home-input.js` interpreta registros Linux `input_event` de 32 bits: 16 bytes, little endian.
  Conserva fragmentos entre lecturas y detecta `EV_KEY` (`type=1`), HOME (`code=773` por defecto)
  y pulsación (`value=1`). Ignora release y repetición mantenida.
- `home-watch.js --watch` abre todos los `/dev/input/event*` en lectura no bloqueante, sin
  `grab`, y los revisa cada 100 ms por defecto, tanto directamente como desde `home-autostart.sh`.
  Aplica debounce de 800 ms y vuelve a buscar
  dispositivos cada segundo. Cada apertura usa `luna-send -n 1 -f` y un argumento JSON separado
  hacia `luna://com.webos.applicationManager/launch`.
  Con `--native-home`, no ejecuta esas aperturas, polling ni discovery; requiere `--watch`.
- `home-power.js` (84 líneas) ejecuta `luna-send -i` al URI fijo
  `luna://com.webos.service.tvpower/power/getPowerState` con `{"subscribe":true}`. El primer
  `Active` fija la base; no activo → `Active` solicita wake una vez, ignorando duplicados.
  Reconecta tras fallo a los 5 s; solo está listo tras recibir un estado válido.
- `--boot` intenta abrir la app hasta 30 veces, separadas por unos 2 s, hasta recibir
  `returnValue: true`. Esa respuesta confirma aceptación del app manager; la comprobación visual
  se hizo al ver la app en primer plano y su título por CDP.
- Un heartbeat de 1 s actualiza su referencia en cada tick: una demora aislada de 3 s no se
  acumula hasta crear un falso wake. Solo si el monitor de potencia no está listo, un gap mayor
  de 10 s inicia hasta cuatro intentos de wake,
  reintentando solo tras fallo y con 1,5 s de espera; una aceptación cancela la campaña.
- Boot, Home y wake comparten un único lanzamiento en curso. La aceptación cancela las campañas
  automáticas; Home puede lanzar otra vez una vez terminada la operación. Un ACK no prueba
  visibilidad. Si Quick Start mantiene la CPU activa, el gap por sí solo no detecta el encendido:
  el caso de apagar 20 s con el control falló en 0.7.0. La 0.7.1 usa la señal de potencia real,
  confirmada físicamente para ese caso. Home registra `home: accepted` o `home: rejected`, sin texto crudo.
- `home-autostart.sh` se ejecuta mediante el symlink de HBC. Comprueba los archivos, valida el
  proceso del PID anterior y evita iniciar un duplicado. Exporta
  `NODE_PATH=/usr/lib/node_modules:/usr/lib/nodejs` y ejecuta
  `nohup /usr/bin/node home-watch.js --boot --watch`, agregando `--native-home` si está el marcador.

El PID está en `/tmp/mipantalla-home.pid`; el log está acotado a 64 KiB en
`/tmp/mipantalla-home.log`. SIGTERM y SIGINT cierran descriptores, temporizadores y el PID propio.
`--dry-run` permite observar detecciones e intentos sin ejecutar `luna-send` ni abrir apps.
`--help` muestra los argumentos disponibles.

La idea se adapta de [`service/service.js`](https://github.com/zzeppieri/webos-custom-home/blob/main/service/service.js)
y [`service/autostart.sh`](https://github.com/zzeppieri/webos-custom-home/blob/main/service/autostart.sh).
Su validación en webOS moderno no acredita esta adaptación a 5.6.2. No se copian su registro
Luna, elevación ni ajustes de eARC.

## Requisitos

- Root y Homebrew Channel con startup elevado y persistente que ejecute `init.d`.
- SSH root operativo como vía de recuperación y acceso físico al control remoto.
- IPK de esta compilación instalado, con los cuatro archivos de Home en el directorio del servicio.
- `/usr/bin/node`, `luna-send` y `nohup`; acceso a input solo para el fallback anterior.

En esta TV los requisitos están cubiertos. No se cambian particiones, roles Luna ni actividades
de HBC. La preferencia de destino Home aplicada en 0.7.2 está documentada arriba.

## Comprobación local y empaquetado

Desde la raíz del checkout, sin contactar la TV:

```powershell
npm test
npm run build
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-package dist services/com.frxn.mipantalla.lights -o artifacts --no-minify
python scripts/verify_package.py
```

El verificador compara los archivos del IPK con `dist/` y el directorio del servicio e informa
el conteo real y el SHA-256. La verificación original del IPK 0.7.2 tuvo 257 pruebas, 57 archivos,
18 del servicio y 1.690.292 bytes. La suite posterior del repositorio pasó 269/269, con 12 tests
de la guardia externa al IPK; el paquete mantiene 57 archivos y 18 del servicio.
Las pruebas con buffers y dobles locales no validan los dispositivos de entrada, permisos Luna,
foco, arranque ni standby de la TV.

## Instalación y activación

El IPK 0.7.7 está instalado; root, HBC y el hook ya estaban operativos. No hay que repetir root ni HBC
para comprobar esta versión. Como referencia de recuperación, se puede usar el instalador de
Developer Mode o `luna-send` en la TV. Si `/dev/install` responde
`Unknown method "install" for category "/dev"`, reiniciar el instalador después de habilitar
Developer Mode:

```sh
systemctl restart appinstalld
```

El hook ya existe. Para comprobar que no esté roto:

```sh
SERVICE_DIR=/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights
HOOK=/var/lib/webosbrew/init.d/60-mipantalla-home
ls -l "$SERVICE_DIR/home-input.js" "$SERVICE_DIR/home-power.js" "$SERVICE_DIR/home-watch.js" "$SERVICE_DIR/home-autostart.sh"
readlink "$HOOK"
cat /tmp/mipantalla-home.pid
ps -ef | grep '[h]ome-watch'
tail -n 40 /tmp/mipantalla-home.log
```

Para crear el hook solo si falta, después de comprobar las rutas y el destino:

```sh
SERVICE_DIR=/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights
HOOK=/var/lib/webosbrew/init.d/60-mipantalla-home
(
  set -e
  test "$(id -u)" = 0
  test -f "$SERVICE_DIR/home-watch.js"
  test -f "$SERVICE_DIR/home-power.js"
  test -f "$SERVICE_DIR/home-autostart.sh"
  chmod 755 "$SERVICE_DIR/home-autostart.sh"
  mkdir -p /var/lib/webosbrew/init.d
  test -e "$HOOK" || ln -s "$SERVICE_DIR/home-autostart.sh" "$HOOK"
  /bin/sh "$HOOK"
)
cat /tmp/mipantalla-home.pid
tail -n 40 /tmp/mipantalla-home.log
```

`ln -s` falla si el nombre ya está ocupado; no lo sobreescribe. El script sale 0 para no bloquear
el startup de HBC. Ejecutarlo manualmente también permite reiniciar el watcher con sustitución
controlada del proceso anterior.

## Home confirmado y revalidaciones pendientes

En 0.7.1 el dueño confirmó YouTube → Home → Mi pantalla tras esperar 2 s. Esta guía sirve para
comprobar foco, repetición y regreso desde otras apps; esos casos adicionales siguen pendientes.
Los comandos de input siguientes documentan el fallback anterior; no corresponden al Home nativo
activo en 0.7.2. Home físico desde YouTube y encendido tras apagar 20 s quedaron confirmados
directos a Mi pantalla, sin LG primero en esos dos casos.

Primero observar HOME sin abrir apps. Ejecutar en una sesión SSH root:

```sh
SERVICE_DIR=/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights
/usr/bin/node "$SERVICE_DIR/home-watch.js" --boot --watch --dry-run
```

Pulsar Home desde otra app y mirar el log desde una segunda sesión root:

```sh
tail -n 40 /tmp/mipantalla-home.log
```

Debe aparecer la detección o el intento de lanzamiento en dry-run. Terminar con Ctrl+C en la
primera sesión; el PID propio debe desaparecer. Si HOME no se detecta, seguir la sección del
código de tecla antes de habilitar el arranque.

Comprobar explícitamente el permiso de apertura real:

```sh
luna-send -n 1 -f luna://com.webos.applicationManager/launch '{"id":"com.frxn.mipantalla"}'
/usr/bin/node "$SERVICE_DIR/home-watch.js" --watch
```

La llamada debe devolver `returnValue: true`. Con el watcher activo, abrir otra app y pulsar
Home. Verificar que aparece Mi pantalla y que flechas, OK y Atrás conservan foco. Probar Home
repetido, pulsación mantenida y regreso desde varias apps. Terminar con Ctrl+C antes de volver
al hook. Un comando aceptado o un log correcto no sustituyen esa comprobación visual.

## Encontrar el código HOME correcto

Los eventos son binarios: `cat /dev/input/event*` sin decodificar no muestra nombres de teclas.
Además, `cat` procesa el glob secuencialmente y puede quedarse esperando en el primer dispositivo.
Se puede empezar con:

```sh
cat /dev/input/event* | od -An -v -tx1
```

Pulsar Home y cortar con Ctrl+C. Si no aparece, listar y repetir con cada dispositivo concreto;
por ejemplo:

```sh
ls -l /dev/input/event*
cat /dev/input/event0 | od -An -v -tx1
```

En cada registro de **16 bytes**, los primeros 8 son el tiempo; el tipo está en los offsets
8–9, el código en 10–11 y el valor en 12–15. HOME 773 presionado se reconoce por esta cola de
8 bytes: `01 00 05 03 01 00 00 00`. El código `05 03` little endian es `0x0305`, decimal 773.
Release tiene valor `00 00 00 00`; repetición mantenida, `02 00 00 00`.

Si el código observado es diferente, probar su valor decimal con el argumento configurable:

```sh
MI_HOME_CODE=773
/usr/bin/node "$SERVICE_DIR/home-watch.js" --watch --dry-run --home-code="$MI_HOME_CODE"
```

Sustituir 773 por el valor medido. Para hacerlo persistente, añadir ese mismo `--home-code=N`
a la invocación del script **en el checkout**, reconstruir y volver a empaquetar. El script
distribuido usa 773. Si los registros no tienen este formato de 16 bytes, no habilitar el hook:
hay que adaptar y probar el parser a la ABI real.

## Comprobar después de un arranque en frío

Con acceso de recuperación disponible, comprobar por separado:

1. Apagado completo y encendido físico: HBC debe arrancar y Mi pantalla debe abrirse cuando el
   app manager esté disponible. **Verificado previamente con 0.6.0; no revalidado en frío con 0.7.2.**
2. Standby de más de 10 s y vuelta con el control: comprobar las aperturas de wake y el foco.
   **Falló con 0.7.0; en 0.7.2 el dueño confirmó Mi pantalla directamente tras apagar 20 s y encender.**
3. Standby corto y Quick Start+: documentar qué caso realmente suspende el proceso; un heartbeat
   que sigue ejecutándose no detectará el despertar mediante el gap. **Pendiente.**
4. Home desde apps distintas, navegación posterior y ausencia de watchers duplicados.
   **En 0.7.2 YouTube → Home va directo a Mi pantalla, sin LG primero; foco, repetición y otras apps pendientes.**

## Guardia externa de recuperación

La guardia Node 8/ES5 está desplegada fuera del IPK en
`/var/lib/mipantalla-maintenance/native-home/native-home-guard.js`; la evalúa
`/var/lib/webosbrew/init.d/59-mipantalla-home-guard`. El código está en
[`scripts/tv/native-home-guard.js`](../scripts/tv/native-home-guard.js).
Se confirmaron `node --check` con Node 8, `sh -n`, el hash y la ejecución manual con
estado `app-present`, sin llamada Luna. SHA-256:
`14d2e0767a6a20397e6c40bb593ae26336736bd1519a060ef198a6d51a74da2e`.
Con la app ausente, restaura solo el Home anterior preservando el mapa actual; exige lectura
confirmada antes de retirar el marcador. Ante respaldo corrupto, symlink o estado incierto no actúa.
Sus 12 tests están incluidos en los 269/269 del repositorio, fuera de los 257 originales del IPK.
**El fallback en arranque en frío con la app ausente no se probó físicamente.** La recuperación
SSH manual sigue disponible si falla; no se considera validado el guard durante boot por ejecutar su entrypoint a mano.

## Desactivar y revertir

**Antes de desinstalar Mi pantalla, restaurar el destino Home anterior.** Si el default apunta a
una app ausente, su apertura falla. Leer `defaultApps` actual, cambiar únicamente su clave `home`
al valor anterior del respaldo `settings-before.json` (`com.webos.app.fullhome`) y guardar preservando todos los
demás defaults; comprobar la lectura. El respaldo está guardado de forma privada en host y TV.
Si se revierte también `homeAutoLaunch`, su valor previo en `native-home/settings-before.json`
es `on`; restaurar solo esa clave y comprobar la lectura.
Retirar `/var/lib/mipantalla-maintenance/native-home/enabled` y reiniciar solo el watcher con PID
validado y un único proceso. No reemplazar todo `defaultApps` por una copia antigua.
Para retirar también la guardia, comprobar el contenido del hook propio
`/var/lib/webosbrew/init.d/59-mipantalla-home-guard` y quitar ese archivo y su script externo;
conservar el respaldo privado hasta comprobar Home y el encendido originales.

Para desactivar además el hook, retirar **solo nuestro symlink**, comprobando su destino. Luego validar el PID antes de
enviar TERM. Ejecutar en la sesión root de la TV:

```sh
SERVICE_DIR=/media/developer/apps/usr/palm/services/com.frxn.mipantalla.lights
HOOK=/var/lib/webosbrew/init.d/60-mipantalla-home
if [ -L "$HOOK" ] && [ "$(readlink "$HOOK")" = "$SERVICE_DIR/home-autostart.sh" ]; then
  rm "$HOOK"
else
  echo 'Hook ausente o distinto; no se borra.'
fi
MI_HOME_PID=$(cat /tmp/mipantalla-home.pid 2>/dev/null)
case "$MI_HOME_PID" in
  ''|*[!0-9]*) echo 'Sin PID válido; no se envía ninguna señal.' ;;
  *)
    if [ "$MI_HOME_PID" -gt 1 ] && [ -r "/proc/$MI_HOME_PID/cmdline" ] &&
       tr '\000' '\n' < "/proc/$MI_HOME_PID/cmdline" |
       grep -Fx "$SERVICE_DIR/home-watch.js" >/dev/null; then
      kill -TERM "$MI_HOME_PID"
    else
      echo 'El PID no corresponde al watcher; no se envía ninguna señal.'
    fi
    ;;
esac
sleep 1
ls -l /tmp/mipantalla-home.pid
tail -n 20 /tmp/mipantalla-home.log
```

Con el default Home restaurado, el proceso terminado y el symlink retirado, Home vuelve a depender del comportamiento
original de LG; comprobarlo físicamente. El daemon retira su PID al cerrar limpiamente.
Si persiste, inspeccionar el proceso antes de otra acción. No usar `killall node`.
El log se puede conservar como evidencia. Desinstalar el IPK por sí solo no retira el hook ni
garantiza que termine un watcher ya iniciado: hacer primero este rollback.

## Riesgos y límites pendientes

- En el fallback de input sin `grab`, LG también recibe Home. La 0.7.2 usa destino nativo, pero
  la prueba de primer plano no demuestra ausencia de una aparición inicial de LG ni latencia.
- Home tiene confirmación física previa; foco y repetición necesitan revalidación actual.
  Standby falló tras apagar 20 s con el control en 0.7.0 y ese caso quedó confirmado en 0.7.1,
  igual que Home desde YouTube tras 2 s. Otros ciclos y la desinstalación completa no se probaron.
  En 0.7.2 ambos casos físicos van directos a Mi pantalla, sin LG primero; no acredita otros ciclos.
- Wake reintenta hasta cuatro veces solo tras fallo y cancela al recibir aceptación. Un ajuste
  del reloj o una pausa larga también puede simular un wake; con CPU activa puede no haber gap.
- El polling anterior de 9 dispositivos cada 100 ms consumió alrededor de 4,4 % de CPU en reposo en esta
  TV, con 60,29 FPS para la app. Medir de nuevo si se agregan más dispositivos o se baja el
  intervalo.
- Root/HBC persistentes, Developer Mode, reinstalaciones o actualizaciones pueden cambiar rutas
  y startup. Un hook que apunta a un paquete eliminado queda roto. Mantener la recuperación SSH
  y probar la desactivación antes de dar la integración por validada.
