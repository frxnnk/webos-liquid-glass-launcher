# Asistente local de instalación: piloto

Estado al **2026-10-21**. El programa ya está implementado en `installer/` y se inicia con
`npm run setup`. Sirve una interfaz local para Brave; no instala un agente de instalación
permanente en la TV. **Mi pantalla 0.7.11 ya está instalada; el botón Pantalla completa todavía
requiere prueba física.** En el checkpoint 0.7.6 desde el asistente de PC, el dueño confirmó
colores de video en seis WiZ y se verificó su restauración 6/6, incluidas dos escenas.
Este trabajo no es un rediseño nuevo del Home.

La interfaz renovada explica las claves SSH y agrega controles separados para root y captura.
**Instalar y optimizar requiere root comprobado. La cadena de root inicial está implementada
como experimental, sin validación completa sobre una TV original.** Ver el alcance y los
pendientes antes de tratar un resultado local como una prueba en hardware.

## Requisitos exactos

- Único perfil admitido: **LG 49UN7310PSC**, firmware **04.64.00**, webOS **5.6.2-21**,
  build `jhericurl-jimna`, board **K6LP_ATSC_BR**. Otra combinación queda bloqueada.
- Computadora con **Node 18+**, npm, OpenSSH y Brave. El bootstrap experimental también requiere
  **Python 3.8+**. Sin nuevas dependencias npm.
- TV encendida en la misma red y una clave SSH local: de Developer Mode para evaluar root
  inicial, o con acceso root en puerto 22 para instalar, optimizar y configurar captura.
- Las huellas SSH deben verificarse por un canal confiable y quedar en `known_hosts`; no se
  aceptan automáticamente. Los puertos nuevos 2222/22 pueden requerir intervención humana.
  No borrar huellas ni repetir la cadena para saltear una interrupción.
- [Registro específico de root y recuperación](root-and-home.md). El asistente no degrada
  firmware ni reinicia físicamente la TV; sí reinicia componentes de captura al prepararlos.

## Abrirlo

Desde un checkout del repositorio:

```sh
npm run setup
```

En PowerShell usar `npm.cmd run setup` si la política bloquea `npm.ps1`. Abrir en Brave la URL
que muestra la terminal. Escucha sólo `127.0.0.1`, con puerto dinámico; no hay un puerto fijo que
abrir en el router. Mantener la terminal abierta y cerrar el servidor con Ctrl+C al terminar.

1. Ingresar la IPv4 privada de la TV y elegir **Buscar claves en esta PC**, o escribir la
   **ruta absoluta** del archivo de clave SSH. La búsqueda no elige ninguna automáticamente.
2. Pulsar **Comprobar conexión** para instalar/optimizar, o **Revisar root** para evaluar el
   acceso. Revisar modelo, firmware y el estado confirmado; una consulta no ejecuta el bootstrap.
3. Elegir únicamente las acciones deseadas. Todavía no hay cambios en la TV.
4. Pulsar **Preparar plan**. El plan vence a los cinco minutos; cambiar destino u opciones
   exige otro plan. Antes de escribir, el motor vuelve a leer el estado y detecta cambios.
5. Revisar los pasos y pulsar **Aplicar plan revisado**. Un resultado parcial conserva pendientes;
   no significa que todo haya quedado aplicado ni probado físicamente.

### Qué es el archivo de identidad

Es la clave SSH guardada en esta computadora cuando vinculaste la TV: por ejemplo,
`C:\Users\TuUsuario\.ssh\mi-tv`. En el campo va **la ruta**, no el texto del archivo.
**No es el PIN de Developer Mode**, una contraseña ni un código que muestre el televisor.

La búsqueda consulta ubicaciones conocidas y metadatos de archivos; también puede recuperar
rutas de journals privados del asistente. No abre archivos de clave privada. El navegador
recibe las rutas para que elijas, nunca su contenido, y no las persiste en almacenamiento local.
OpenSSH usa el archivo en la PC; el flujo experimental de root también usa `ssh-keygen` para
derivar la clave pública. Sólo esa clave pública se incorpora al acceso de la TV.

`status`, `plan`, `apply`, `restore` y las acciones de root/captura son API internas del asistente.
No existen comandos CLI públicos `setup --plan`, `--apply` o `--restore`.

## Qué implementa este piloto

| Acción elegida | Alcance y límite |
| --- | --- |
| Instalar Mi pantalla | Si la app está ausente, descarga el IPK público fijo y comprueba SHA-256 antes de instalar. Con 0.7.11 ya instalada omite ese paso. Otra versión queda bloqueada hasta implementar preservación de actualizaciones. |
| Usar Mi pantalla como inicio | Cambia sólo `home` dentro del mapa actual de defaults; prepara Home nativo, arranque y guardia mediante hooks propios 59/60 de HBC. Conserva baselines históricos. |
| Reducir publicidad de LG | Siete preferencias conocidas y los dos permisos RDX `analyticsLog`/`crashLog`; respaldo, lectura posterior y hook propio 61. No apaga todo el tráfico de la TV. |
| Apps LG opcionales | Sólo LG Streaming Week (`webos.day`), LG Sports Playbook (`epoxyaisports`) y LG Channels (`lgchannels.home`), marcadas individualmente. Exige no sistema y removible; no permite IDs arbitrarios. |

No instala Nuvio. La captura tiene su propio recorrido, separado del plan de limpieza.

### Root inicial experimental

**Preparar root** sólo evalúa requisitos y genera un plan de cinco minutos. **Aplicar root
revisado** ejecuta esas etapas únicamente tras mostrarlas: fuentes fijadas por hash, bootstrap
propio para este perfil, root temporal, conservación/verificación del script firmado y token
de Developer Mode, HBC y comprobaciones de acceso. Si la TV ya tiene root, omite la cadena.

El registro upstream anterior necesitó recuperación manual de Developer Mode. La cadena nueva
evita ejecutar su `autoroot.sh`, conserva los respaldos y mantiene una reserva exclusiva por
host aunque cambies el archivo de clave. Una interrupción deja recuperación pendiente; no hay
reanudación o rollback automático de un root interrumpido. Las huellas SSH nuevas siguen
necesitando verificación humana. **Ni los tests locales ni un login SSH prueban arranque físico
o un recorrido completo desde stock.**

### Luces siguiendo el video

1. **Revisar captura** consulta componentes, configuración, sesión y pruebas disponibles.
2. **Preparar captura** instala las versiones fijadas de PicCap/HyperHDR que falten y prepara
   la configuración privada de esta TV. Conserva un respaldo previo y solicita salida LED
   deshabilitada durante la preparación; no equivale a activar la sincronización.
3. **Activar** sólo se habilita cuando la captura está disponible y verificada, incluyendo
   configuración, frames y confirmación de hardware de esta unidad. Un ACK no acredita luces.
4. **Desactivar** detiene la sesión y restaura los estados de las lámparas guardados antes de
   activarla. También permite recuperar una sesión pendiente; un estado desconocido no figura
   como apagado y no habilita otra activación.

El modo **Acompañar fondo** usa la foto del launcher y sigue separado de la captura del video.
PicCap 0.5.3 y HyperHDR 22.0.1 ya se reinstalaron y la captura volvió a informar UI y video a
29,44–29,5 FPS con YouTube abierto por el dueño. Se preservó el perfil histórico de las seis
WiZ y se confirmó el servicio propio ejecutándose como root, después de que su ejecución en
jaula no pudiera leer la configuración `600`.

El primer intento se bloqueó **antes de crear el baseline y habilitar la salida** porque dos
lámparas en escena 6 no devolvían RGB. Con la 0.7.6 instalada, Brave mostró sincronización activa
y el dueño confirmó que las seis siguen los colores del video. Se admite `sceneId` de 1 a 255
como alternativa a RGB o temperatura; la escena 6 es el caso observado. Custom scenes y Rhythm
quedan fuera. **Desactivar** devolvió el resultado de luces restauradas y una consulta
independiente al servicio más `getPilot` de las lámparas confirmó **6/6** iguales al estado
original: encendido, brillo, RGB, temperatura y escena, incluidas las dos escenas originales.
Esto no acredita HDMI, contenido protegido o captura automática al encender. [Estado exacto](screen-sync.md).
Nunca copiar tokens, direcciones o atestaciones de otra TV.

La 0.7.10 espera la habilitación efectiva de `LEDDEVICE`: un ACK de orden encolada no basta.
La fachada de la TV distingue activa de preparada y consulta el estado una vez después de
Pantalla completa o Manual. Si esa lectura falla, conserva el modo confirmado y permite Manual,
sin afirmar luces apagadas. **La prueba física de este botón con 0.7.10 sigue pendiente.**

La 0.7.10 exige el [capturador experimental parcheado](capture-repair.md) para iniciar video.
El asistente no instala ese parche nativo automáticamente. Preparar confirma PicCap apagado
después de guardar ajustes; un fallo o timeout no acredita esa parada. Start y Stop esperan
hasta 25 s y conservan la recuperación pendiente si falta confirmación.

## Paquete público fijado

[Release v0.7.11](https://github.com/frxnnk/webos-liquid-glass-launcher/releases/tag/v0.7.11):
`com.frxn.mipantalla_0.7.11_all.ipk`, **63 archivos, 1.702.700 bytes**.

```text
SHA-256: d2fa75d444c3f39d1a88766a170eb482e9f39d42f0e47d6f13ee6f5d45d5f759
```

No contiene `weather-config.js`, `lights-config.js` ni `screen-config.json`. Es distinto del IPK
privado instalado en la TV: no sobrescribir una instalación 0.7.11 existente
con este paquete para «igualar hashes». El piloto la omite; la actualización con preservación
de configuración privada sigue pendiente. El hash se verifica también antes de la instalación
remota; una descarga fallida o distinta no se instala.

## Respaldos, timeout y restauración

El journal y los snapshots locales quedan en `~/.mi-pantalla-installer/`; los respaldos de la TV,
en `/var/lib/mipantalla-maintenance/setup/ID_DEL_RESPALDO/`. Contienen datos del destino: son
privados, no subirlos a GitHub. En Windows proteger también la carpeta con sus ACL.

El journal usa escritura anticipada (WAL), archivo temporal, `fsync` del archivo y rename.
No hace `fsync` del directorio: no se acredita recuperación ante pérdida total de alimentación.
Usar **una sola instancia del programa por TV** para los cambios normales. El flujo de root
tiene además una reserva exclusiva persistente por host entre procesos: no se recicla por
antigüedad, cambio de clave o un resultado incierto. Eso no extiende la protección a todos los
otros cambios del asistente ni acredita tolerancia a cortes de alimentación.

Los campos de conexión no se persisten en el navegador ni se envían a un servidor público.
La API exige el origen de loopback y una sesión local; no expone una shell arbitraria.

Si aparece timeout o respuesta incierta, **no repetir Aplicar**. Volver al mismo destino y usar
**Revisar estado**: el motor recupera el journal asociado a esa TV y muestra la operación pendiente.
Cambiar de destino no habilita restaurar el respaldo anterior sobre otra TV. La consulta de
recuperación no vuelve a ejecutar la operación que pudo haber terminado.
Para root usar **Revisar root**; para luces, **Revisar captura**. Los respaldos de root y la
sesión de lámparas son independientes de **Restaurar** del plan normal. `rootApply` y
`screenPrepare` tienen una espera local finita de unos cinco minutos; el resto, unos dos.

La configuración privada exige servicio root y un almacén de sesiones privado. En esta unidad
se migró de forma acotada un almacén antiguo de la jaula **vacío y sin baseline** a root `0700`.
No se hizo `chown` recursivo ni se permite migrar automáticamente sobre una sesión pendiente:
ese respaldo se conserva para recuperar las lámparas. La definición del servicio usa una copia
root `0500` del wrapper, con bytes fijados, dentro de `0700`; no relaja permisos de la clave ni
de los tokens. [Procedimiento y límites de captura](screen-sync.md#recuperación-y-límites-del-checkpoint-076).

**Restaurar** usa el respaldo devuelto por la operación. Restaura preferencias y retira los hooks
propios creados por ese plan, conservando archivos y baselines previos. No borra el Home de LG.
Hay dos límites explícitos: las apps retiradas deben reinstalarse manualmente desde su tienda,
si siguen disponibles, y una app instalada por el plan se desinstala manualmente **después de
restaurar y comprobar Home**. No se recuperan sesiones ni datos borrados de otras apps.

## Qué está probado y qué falta

El piloto anterior pasó **401/401 pruebas**. En Brave,
contra la TV exacta, se comprobaron `status` y `plan`, y se aplicó **sólo privacidad de forma
idempotente**: las siete preferencias ya estaban apagadas y ambos permisos RDX ya en `false`.
Se crearon respaldos reales en PC/TV y el snapshot posterior coincidió con el previo al plan.
Esto no prueba cambiar esos ajustes desde sus valores originales.

Tras recargar Brave y volver a ingresar el destino, `status` recuperó el respaldo real y habilitó
**Restaurar**. El restore terminó completado; una lectura SSH separada confirmó journal en
`restored` y snapshot completo idéntico al previo: mapa de defaults, siete preferencias, RDX,
tres IDs LG, app, release y modelo. No se aplicaron Home, instalación ni bajas de apps con este
piloto. No se probó instalar el IPK público en la TV, partir de una TV original ni un arranque
físico o hook nuevo al encender. Cortes de red también requieren pruebas propias.
[Home y recuperación](home-takeover.md).

En Node 8 de la TV, el primer intento de compilar desde stdin abortó con `SIGABRT`. Los helpers
usan `node -e` leyendo el código por FD 3, stdin en `/dev/null` y `LD_PRELOAD` vacío para ese hijo;
no requieren cambiar globalmente el entorno de Node de la TV.

La UI nueva pasó **33 pruebas locales**, y la revisión de root/reservas pasó **42 pruebas
locales**, incluida la regresión de dos instancias contra un host. Son pruebas del contrato y
de operaciones simuladas/locales, no ejecución del exploit en una TV original. La suite completa
de la versión actual pasó **555/555 pruebas**. Los colores y la restauración de 0.7.6
tienen evidencia separada en la TV y confirmación del dueño; la restauración al desactivar se
contrastó de forma independiente en **6/6 lámparas**, incluidas dos escenas. Reinicio, HDMI y
contenido protegido siguen pendientes. **No se instaló otro diseño del Home** como parte del rediseño de
este programa de PC.
