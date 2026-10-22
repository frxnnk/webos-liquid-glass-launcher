# Privacidad, publicidad y limpieza de LG

Revisión de fuentes del 21 de octubre de 2026 para la **49UN7310PSC, webOS 5.6.2-21**.
La revisión comenzó con Mi pantalla **0.7.4** y se actualizó con mantenimiento sobre **0.7.5**.
Se separan los cambios comprobados de las propuestas de endurecimiento todavía no aplicadas.

Podemos reducir publicidad, reconocimiento de contenido y conexiones prescindibles.
No podemos certificar «cero espionaje» por ocultar el Home, apagar una preferencia o resolver
un dominio hacia una dirección sin servicio. Las apps de streaming tienen sus propias
cuentas, permisos y comunicaciones; reemplazar el launcher no las modifica.

## Qué está hecho

El historial y la reversión están en [Limpieza](cleaning.md). Hasta esta revisión:

- Se retiraron tres apps removibles: LG Streaming Week, LG Sports Playbook y LG Channels.
- Después se retiraron Apple Music, Apple TV, DGO y Star+ por selección del dueño; se
  conservaron las seis apps indicadas y las siete principales/herramientas protegidas.
- Se comprobaron en `off` `livePlus`, `livePromotion`, `webOSPromotionVideo`, `homePromotion`,
  `screenSaverAd` y `adCookie`. `customizedAd` ya se había leído en `off`.
- La recomendación personal está desactivada. Los consentimientos completos de ACR,
  reconocimiento de voz y publicidad personalizada no se volvieron a auditar desde su pantalla.
- Mi pantalla es el destino nativo de Home. El Home de LG sigue instalado como recuperación.
- Se desactivaron `analyticsLog` y `crashLog` de `rdxd`, con respaldo y lectura posterior.
  El servicio sigue activo. [Procedimiento, hook y límites](diagnostic-privacy.md).
- No se instalaron bloqueadores DNS ni se deshabilitaron servicios de anuncios, voz o ThinQ.
  No se hizo una purga general de datos, cachés o registros.

Estos ajustes son evidencia de preferencias concretas. No equivalen a medir qué datos
envía cada proceso. El inventario posterior a ambas rondas conserva 117 apps, incluidas 104
marcadas por la TV como de sistema; esa marca tampoco demuestra que una app esté ejecutándose.

La lectura nueva de esta revisión volvió a confirmar esos valores, las tres apps ausentes
y Homebrew Channel 0.7.3. También encontró servicios activos como `remotelogger`, `uploadd`,
`rdxd`, `voiceconductor` y `voiceinput`: **no se deshabilitaron**. Los dos permisos de
reportes de `rdxd` se cambiaron por separado, sin reiniciarlo. Una muestra breve mostró
aproximadamente un núcleo ocupado por `iconnectivity`, sobre cuatro núcleos. Sigue en
investigación; esa muestra no identifica la causa ni prueba transmisión de datos personales.

Según [LG](https://www.lg.com/global/newsroom/news/statements/statement-understanding-privacy-on-lg-smart-tvs/),
los consentimientos de ACR, voz y publicidad son opcionales y pueden retirarse desde la TV;
su funcionamiento y alcance dependen del mercado. LG describe ACR mediante huellas de audio.
Es una explicación del fabricante, no una auditoría independiente ni una confirmación de
los consentimientos actuales de esta unidad con webOS 5.6.

## Qué encontramos en Homebrew Channel

En el catálogo central consultado aparece **Life's Good Without Spying**, con ID
`ooo.lew.lifesgoodwithoutspying`. No encontramos una entrada llamada exactamente
«CleanYourLG» en ese catálogo ni un repositorio con ese nombre en la búsqueda realizada.
Si el nombre visto en otra tienda es diferente, hay que comparar su ID y procedencia.

La entrada del [catálogo Homebrew](https://github.com/webosbrew/apps-repo/blob/291da2bce269fbc901a0716b645caf64f709e3dc/packages/ooo.lew.lifesgoodwithoutspying.yml)
declara `webosRelease: >=5.0`. Eso es un requisito de distribución, no una prueba sobre
nuestro modelo. El [README del autor](https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/README.md)
declara pruebas propias en webOS 23, versión interna 9, y funcionamiento en webOS 5 informado
por terceros. **No lo probamos en esta TV.**

Se revisaron las fuentes de **v0.6.0**, commit
`0d371db91eb5cc49c8fb645082b44780c644b815`. La
[release](https://github.com/lewisdoesstuff/lifesgoodwithoutspying/releases/tag/v0.6.0)
publica para su IPK el digest SHA-256
`e88208fb89624195dcf5f275dadc3fd88c0690f9495902de44fe62bd8953af8f`.
En esta investigación se consultó esa metadata: no se instaló ni se inspeccionó el binario
del IPK, y no se verificó una compilación reproducible a partir de ese commit.

## Qué hace realmente esa versión

La siguiente tabla describe código, no acciones ya aplicadas en nuestra TV.

| Componente | Mecanismo | Qué se puede perder o qué queda fuera |
| --- | --- | --- |
| Dominios SmartAd, ACR, recomendaciones y diagnósticos | Genera un archivo y lo monta sobre `/etc/hosts`, con entradas IPv4 e IPv6 por nombre exacto | Un servicio con otro resolver, DNS cifrado o conexión por IP puede eludirlo. Los nombres compartidos con servicios útiles requieren pruebas |
| Procesos de publicidad y ACR | Detiene unidades cuando existen, monta un ejecutable inerte sobre rutas candidatas y termina procesos que coinciden por `/proc/PID/exe` | Sólo cubre esas rutas. Un fallo de montaje o una ruta distinta cambia el resultado; hay que leer procesos y montajes después |
| Voz y NLP | Usa el mismo mecanismo y pide cerrar la app de voz | Se pierde búsqueda/entrada por voz; el autor advierte una demora de unos 10 s al abrir Ajustes en algunas versiones |
| ThinQ y asistentes | Además de dominios, cubre ejecutables de IoT, ThinQ y Alexa | Puede romper control desde el teléfono, emparejamiento y asistentes |
| UPnP/SSDP | Monta un reemplazo que duerme sobre `upnpd`, detiene descubrimiento SSDP | Rompe descubrimiento y casting que dependan de esos servicios |
| Residuos ACR/voz | Borra archivos de hasta tres niveles bajo `/var/log`, `/tmp` y `/var/run` cuyos nombres contienen `acr`, `voice`, `alphonso` o `stt` | Es borrado por patrón de nombre, no por un inventario de archivos de nuestra TV. Lo borrado no vuelve con Disable |
| Persistencia | Enlaza el script de aplicación desde `init.d` de Homebrew Channel | Los cambios vuelven al arrancar mientras esté ese hook |
| DNS opcional | Inicia un proxy local y desvía DNS saliente IPv4, UDP/TCP puerto 53, con `iptables` | No cubre IPv6, DNS cifrado ni conexiones directas por IP. Si el helper muere, el desvío puede dejar sin resolución hasta revertirlo |

Los objetivos de anuncios incluyen `admanager`, `livepick`, `acr2`, `nudge`, `rdxd`, `uploadd`,
`sportsalarm` y `adoverlay-service`. No significa que todos existan en webOS 5 ni que todos
estén activos. Las rutas ausentes se omiten. Los objetivos de voz incluyen variantes de
`voiceinput`, `voiceconductor`, `voiceclick`, `nlpmanager`, `performer` y la app de voz.

Las llamadas de la interfaz pasan por el servicio de Homebrew Channel: `checkRoot`,
`getAppInfo` y `exec`. El comando ejecutado es el controlador shell de la propia app.
Para cerrar voz se consultan `running` y `close` del Application Manager; para reactivar
UPnP se usa el ping privado de `com.webos.service.upnp`. No es una limpieza hecha solamente
con opciones públicas del menú de LG.

Fuentes: [objetivos, configuración y borrado](https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/app/init/nospy-lib.sh),
[aplicación](https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/app/init/nospy-apply.sh),
[interfaz y llamadas Luna](https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/app/app.js),
[desvío DNS real](https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/dns-filter/scripts/tv-handoff.sh).

## Por qué no habilitar todo de una vez

Hay detalles de v0.6.0 que impiden tratarla como un botón universal de limpieza:

1. **Los defaults incluyen parar voz y borrar residuos al aplicar.** `voice.stop`, `ads.stop`
   y `purge.boot` empiezan en `on`, además de varias categorías de dominios.
2. **Cambiar un toggle ya aplica el conjunto completo.** El comando `set` guarda esa clave
   y llama al script de aplicación aunque todavía no se haya pulsado Enable Protection.
   Apagar opciones una por una desde la UI no garantiza evitar los otros defaults en el
   primer cambio.
3. **SDP tiene una semántica especial.** Con `domains.sdp: on`, sus dominios quedan libres
   60 s y después se bloquean. Con `off`, el código los incorpora inmediatamente: no es
   una forma de dejar SDP sin bloquear. Según el autor, SDP participa del reloj, registro,
   autenticación, metadata de apps y consentimientos. Ese período permite más que ajustar
   la hora; una hora incorrecta también puede hacer fallar HTTPS.
4. **El texto de DNS y el código no coinciden en todo.** El script fijado mantiene los
   nameservers de ConnMan y usa NAT en `OUTPUT` hacia un listener local. El cambio de IPv6
   es un toggle separado; la app lo deja sin cambios por defecto. Se toma el script como
   evidencia del mecanismo, no la descripción anterior de cambiar el nameserver.
5. **El estado de la UI no sustituye la verificación.** `enable` y `disable` pueden terminar
   imprimiendo su estado de autostart aunque el script llamado haya fallado. El self-test
   de `getent`/`curl` demuestra el resolver de esos comandos, no el tráfico de todos los
   servicios. Un proceso que no está en la lista de objetivos tampoco queda cubierto.

Estas conclusiones salen del
[controlador](https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/app/init/nospy-ctl.sh)
y de las fuentes fijadas arriba. No se habilitó esa app para comprobarlas en hardware.

## Plan propuesto para esta TV

Este plan queda **pendiente**; no describe una ejecución terminada.

| Lote propuesto | Estado y alcance | Se conserva en el primer lote |
| --- | --- | --- |
| Revisar consentimientos opcionales | Pendiente: leer y retirar sólo los acuerdos no necesarios para las funciones elegidas | Acuerdos y servicios necesarios para las apps y la tienda |
| Retirar apps removibles sin uso | Tres LG y cuatro de terceros retiradas; seis candidatas conservadas por selección del dueño | Apps del usuario y herramientas de recuperación |
| Frenar objetivos de ACR/publicidad | Inventario hecho el 22 de octubre de 2026 (ver abajo); falta que el dueño apruebe una lista antes de aplicar nada | Voz, conectividad, ThinQ, UPnP, Settings, reproducción y DRM |
| Filtrar endpoints específicos | Pendiente: lista pequeña, prueba por lote y restauración comprobada | SDP, actualizaciones, tienda y resolución normal de DNS |
| DNS residente, voz y purga | Fuera del primer perfil; no aplicados | No sumar un proxy ni borrar registros al probar el primer lote |

### 1. Completar las lecturas y los consentimientos

Registrar antes de cambiar: versión, inventario, ajustes relevantes, procesos existentes,
montajes sobre `hosts`, hooks de arranque y configuración mínima de red necesaria para
revertir. Guardar todo en privado, sin publicar IP, identificadores, redes ni credenciales.
Desde los acuerdos del usuario en Ajustes, revisar qué consentimientos opcionales de
información de visualización/ACR, voz y anuncios siguen concedidos. La ubicación y los nombres
pueden variar por región y firmware: documentar lo que realmente muestra esta unidad.
No retirar a ciegas los acuerdos necesarios para usar las apps elegidas.

### 2. Aplicar un primer perfil pequeño y reversible

Conservar Homebrew Channel, el destino Home propio y el fallback de LG, Application Manager,
Settings, servicios de red, audio/video, HDMI/CEC, DRM y las apps del usuario.
Retirar otras apps removibles solamente si se decide que no se usan. Mantener una lista de
IDs exactos y una vía de reinstalación: no borrar directorios del firmware por su nombre.

Para endurecer procesos y dominios, preparar **antes de ejecutar** una lista revisable de
objetivos presentes en webOS 5. Empezar por publicidad/ACR comprobados y una lista pequeña
de endpoints; dejar fuera voz, ThinQ, UPnP/SSDP, SDP, bloqueo de actualizaciones, proxy DNS y
borrado de residuos en esa primera fase. No se consigue ese perfil simplemente apagando
toggles en la versión upstream revisada: requiere una adaptación explícita y revisada o
un mecanismo propio que respete esos límites.

Las listas contienen nombres como `lgrecommends.lgappstv.com` y servicios de plataforma;
la etiqueta «recomendaciones» no prueba que bloquearlos sea inocuo para Content Store.
No copiar una blocklist entera sin probar instalación, actualización e inicio de sesión.

### 3. Medir y comprobar cada lote

Después de cada lote, comprobar la lectura de preferencias, procesos por ruta y los montajes
esperados. Verificar reloj, conectividad, tienda, instalación, HDMI 1, audio, WiZ, encendido,
Home y reproducción/inicio de sesión de YouTube, Spotify, Netflix y Disney+.
Esperar un período acotado y revisar si los procesos reaparecen o aumentan CPU por reintentos.
Medir RAM/CPU y respuesta de la UI antes/después con el mismo escenario. Liberar almacenamiento
no demuestra una mejora de FPS.

Si se evalúa DNS en otra fase, empezar con un plan de restauración disponible desde la LAN
y medir resolución normal, bloqueada y caída del helper. Un filtrado externo por dispositivo
evita sumar un proxy residente a la TV, pero tampoco permite prometer que el tráfico cifrado
desaparezca. No se ha configurado ninguna de las dos variantes en esta unidad.

### 4. Tratar la reversión como parte del cambio

Guardar el estado previo real. Desactivar protección y retirar su hook **antes de desinstalar**
una herramienta con persistencia; verificar que se desmontaron sus reemplazos y que volvió
la conectividad. Una restauración que arranca todas las unidades candidatas no reproduce
necesariamente cuáles estaban apagadas antes.

El [script de retirada upstream](https://github.com/lewisdoesstuff/lifesgoodwithoutspying/blob/0d371db91eb5cc49c8fb645082b44780c644b815/app/init/nospy-remove.sh)
intenta deshacer DNS y montajes y reactivar servicios. No recupera los archivos purgados ni
sesiones perdidas al borrar datos. Los cambios de limpieza previos del proyecto se revierten
con sus propios respaldos, como explica [Limpieza](cleaning.md#cómo-revertir).

## Privacidad de Mi pantalla

Nuestra UI tampoco debe confundirse con una TV desconectada:

- El clima consulta Open-Meteo con coordenadas configuradas del centro de una ciudad; no
  solicita geolocalización al navegador. El servidor recibe esa consulta y la IP pública.
- Las fotos diarias consultan Wikimedia Commons y descargan imágenes de sus servidores;
  esas conexiones también son externas. Las fotos locales no necesitan esa descarga.
- WiZ se controla en la red local. Los permisos y la telemetría de las apps originales
  de streaming no pasan a estar controlados por nuestro launcher.

El código está en [weather.js](../weather.js), [daily-photos.js](../daily-photos.js) y el
[servicio de luces](../services/com.frxn.mipantalla.lights/). No afirmamos ausencia total de
tráfico por revisar esas funciones: para eso hace falta un inventario y una medición de red
con alcance y duración explícitos. Los respaldos de la TV nunca van en el repo público.

## Auditor reutilizable desde la computadora

El [script de auditoría](../scripts/privacy-audit.cjs) requiere Node 18 o posterior, OpenSSH,
una TV que **ya tenga root** y una clave autorizada. No rootea, instala, borra, modifica ajustes
ni busca otros equipos. Primero se verifica la huella del host con SSH normal; el script exige
`StrictHostKeyChecking=yes`, usa autenticación no interactiva y no lee el archivo de la clave.
No pasar contraseñas, passphrases ni comandos remotos como argumentos.

```powershell
node scripts/privacy-audit.cjs --help
node scripts/privacy-audit.cjs --host IP_DE_TU_TV --identity RUTA_DE_TU_CLAVE
```

Opcionalmente, `--port 22` permite elegir el puerto y `--output RUTA_PRIVADA_NUEVA.json` guarda
el informe saneado. Sin `--output` no se guarda ningún archivo. El archivo nuevo usa modo
`0600`; en Windows hay que conservarlo en una carpeta con ACL privadas. No se sobrescriben
archivos existentes ni se publican los informes.

En una única conexión consulta inventario y preferencias conocidas, memoria, espacio de
`/media/developer` y dos muestras de CPU con una pausa de 2 s, más el tiempo de las lecturas.
Informa conteos de apps, presencia y versión de Homebrew Channel y Mi pantalla, si Home apunta
a Mi pantalla, flags conocidos y procesos con nombre/RSS/CPU. No muestra los otros defaults.
No muestra títulos de otras apps, IP, MAC, serial, credenciales, configuración de red ni
líneas de comandos de procesos. Un valor desconocido no se convierte en «apagado».
El porcentaje por proceso es sobre toda la máquina, no sobre un núcleo; la muestra breve
no explica por sí sola un consumo ni certifica ausencia de telemetría.

El auditor no es el instalador automático propuesto para el navegador. Es un primer paso
reutilizable de lectura y diagnóstico; instalar y cambiar el sistema requiere otra fase.

## Inventario de objetivos de anuncios/ACR (22 de octubre de 2026, sólo lectura)

Auditoría `scripts/privacy-audit.cjs` y lectura de procesos, ejecutables y servicios en la 49UN7310PSC
(webOS 5.6.2, 120 apps). No se detuvo, montó ni modificó nada.

- Preferencias de promociones, cookies publicitarias, anuncios personalizados, recomendación
  personal, Live Plus, promoción de Live y video promocional siguen en `off`.
- **Corriendo ahora:** `admanager`, `adoverlay-service`, `nudge`, `rdxd`, `uploadd`,
  `sportsalarm`, `remotelogger` y `crashd`. Que corran no prueba que envíen datos.
- **Presentes pero sin proceso en la muestra:** `acr2` y `livepick-plus` (hay ejecutable y servicio luna).
- No hay montajes inertes ni Life's Good Without Spying. Hooks activos en Homebrew:
  `59-mipantalla-home-guard`, `60-mipantalla-home` y `61-mipantalla-privacy-rdxd`.

**No se aplicó ningún bloqueo.** Candidatos de menor riesgo para revisar con el dueño: `admanager` y
`adoverlay-service` (publicidad del Home de LG, que ya no se usa). `nudge`, `sportsalarm`,
`uploadd` y `remotelogger` podrían afectar notificaciones, deportes o diagnósticos y requieren
prueba aparte; `acr2`/`livepick-plus` quedan como están hasta confirmar que corren. Cualquier cambio
debe ser reversible, con respaldo y lectura posterior, y se verifica con Content Store y apps de
streaming abiertas. «Cero telemetría» no se puede demostrar con este método.

### Prueba de detención en caliente (22 de octubre de 2026)

Se envió una única señal `TERM` a `admanager` y `adoverlay-service` para ver si un bloqueo valdría
la pena. `adoverlay-service` **volvió a aparecer** en segundos con otro PID (lo supervisa otro
proceso) y `admanager` no se reinició de inmediato. Mi pantalla siguió en primer plano. Ambos
mostraban 0 s de CPU antes. **No se instaló ningún hook persistente**: no hay ganancia medible de
privacidad ni de recursos que justifique repetir kills o montar ejecutables inertes. `admanager`
volverá cuando algo lo pida o al reiniciar.
