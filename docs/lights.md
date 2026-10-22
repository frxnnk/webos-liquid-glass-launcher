# Luces WiZ del living

La 0.5 incorpora el botón **Luces**, junto a Personalizar. El dueño comprobó en la TV que las
seis lámparas seleccionadas responden al brillo del 50 %. Ese control manual no necesita root.
Después de instalar la 0.5.1, el dueño también confirmó que Acompañar fondo funciona. El primer
intento no lo mostró; sin un mensaje de error no se atribuye una causa a esa demora.

La 0.6.0 agrega **Revisar captura**, transporte local para HyperHDR y **Pantalla completa** con
frames frescos de PicCap. Esta compilación suma el hook de Home. Pasaron 234 pruebas y se
verificó el paquete de 56 archivos, incluidos 17 del servicio. La activación física encendió las
seis lámparas con colores de pantalla y la vuelta a Manual las apagó y restauró; la primera parada
pidió reintentar. HDMI, contenido protegido y persistencia de Pantalla completa tras reinicio
siguen pendientes. [Estado de la integración](screen-sync.md).

## Estado actual: 0.7.7

La 0.7.7 está instalada y corrige la confirmación de `LEDDEVICE` después de una orden
encolada y el estado activo/preparado de la UI de la TV. Pasó **555/555 pruebas**; el botón
Pantalla completa todavía requiere prueba física con esta versión. El panel hace una sola
consulta posterior a cada cambio confirmado a Pantalla completa o Manual; ante error conserva
el modo confirmado y permite recuperar con Manual. [Detalle y límites](screen-sync.md).

### Checkpoint 0.7.6 desde el asistente de PC

PicCap 0.5.3 e HyperHDR 22.0.1 se recuperaron con el perfil de las seis WiZ y su orden original.
El dueño confirmó que siguen los colores de YouTube. Al desactivar, una lectura independiente
comprobó **6/6 estados originales**, incluidos dos en escena 6. La suite de ese checkpoint pasó
**541/541 pruebas**; pruebas locales y confirmación física son evidencias distintas.
Boot de captura, HDMI y contenido protegido siguen pendientes.

La restauración admite `sceneId` entero de 1 a 255 como alternativa exclusiva a RGB o temperatura.
Se probó escena 6; escenas personalizadas y Rhythm quedan fuera de alcance.
[Preparar, activar, desactivar y recuperar](screen-sync.md).

## Elegir y controlar las lámparas

### Panel 0.7.4

El panel ahora presenta las lámparas en una columna y el estado del living en una tarjeta
principal con encendido y brillo. Debajo aparecen los tres modos con su explicación, la paleta
de colores, los blancos y el diagnóstico de captura. Sólo la lista de lámparas se desplaza en
la TV; flechas recorren controles y Atrás vuelve al botón Luces.

El resumen confirma encendido y brillo únicamente cuando respondieron todas las lámparas
seleccionadas. Si discrepan muestra «Mixto»; si falta alguna respuesta, «sin confirmar».
Abrir consulta capacidades y las lámparas guardadas; buscar, cambiar colores o activar un modo
siguen requiriendo una acción explícita. La captura conserva sus comprobaciones previas.

Se verificó la vista en Brave a 1080p y 720p con un cliente simulado, incluidas diez lámparas.
En la TV se vieron las seis guardadas y su brillo común. No se enviaron cambios de iluminación
durante esa comprobación. Más tarde el dueño confirmó buen funcionamiento general de 0.7.4.

### Controles

1. Abrí Luces. La primera consulta puede tardar unos segundos mientras el servicio busca las
   lámparas guardadas. Una consulta que falla deja el estado desconocido; no significa apagado.
2. Pulsá **Buscar lámparas** para consultar la red local. Marcá las que correspondan al living.
   Buscar no cambia luces ni selecciona automáticamente todos los dispositivos encontrados.
3. Usá encendido, brillo, colores o temperatura de blanco. Cada orden requiere una respuesta
   y una lectura posterior; los errores se muestran por lámpara. No se reintentan órdenes manuales.

La selección se guarda en la TV. El repo no contiene direcciones ni identificadores del hogar.
Un `lights-config.js` local y excluido de Git puede definir `window.LAUNCHER_LIGHTS.selectedIds`
como selección inicial: solo se usa si todavía no hay una selección guardada. Una selección
vacía guardada se respeta.

## Dos alcances distintos para los colores

**Acompañar fondo**, incorporado en 0.5.1, analiza la foto que muestra Mi pantalla y envía su
color predominante a las lámparas seleccionadas. Se activa al pulsar el botón; no cambia luces
al instalar o abrir la app. Solo se muestra activado después de confirmar el primer color.

Se lee una muestra de 32×18 píxeles y se agrupan colores próximos. No se guardan ni envían
imágenes; el servicio recibe únicamente RGB. Mantiene el brillo y el encendido existentes.
Las fotos remotas necesitan permitir lectura por CORS: si no la permiten, se informa el error
y no se inventa un color. El análisis se hace al cambiar la foto, con un solo envío pendiente.
Después de la activación inicial hay como máximo un reintento por foto ante un fallo.

El modo se pausa cuando Mi pantalla queda oculta. Cambiar la selección o usar un control
manual detiene el acompañamiento; las luces conservan su último estado. Una orden ya enviada
puede terminar después de detenerlo: detener el motor no revierte una orden física en curso.
El modo no se reactiva automáticamente después de cerrar por completo o reiniciar la app.

**Pantalla completa** se habilita solo con configuración válida, `hardwareVerified` atestiguado y
dos muestras frescas de PicCap; la activación y la restauración se probaron físicamente. El canvas
del launcher no ve YouTube, Netflix ni HDMI: la captura la hace PicCap. HDMI, contenido protegido
y persistencia tras reinicio siguen pendientes. Un color del fondo no acredita video.

**Revisar captura** hace una consulta únicamente al pulsarlo; no hace falta tener lámparas
marcadas para solicitar el diagnóstico. No activa captura ni cambia la salida de luces. Muestra
estados de preparación, falta de verificación o error mediante mensajes permitidos, sin exponer
tokens, direcciones ni respuestas crudas. Sin configuración informa captura pendiente; una
configuración comprobada sigue sin acreditar imágenes frescas. Abrir el panel o mover el foco
no ejecuta esta revisión.

La sesión de pantalla está preparada para guardar el estado anterior de las lámparas, confirmar
la parada de la salida y restaurarlo antes de otros cambios. Una recuperación pendiente mantiene
el modo Pantalla completa y bloquea cambios de selección; **Manual** sigue disponible aunque la
selección local esté vacía. Si falla la parada o la restauración, no se confirma Manual ni se
continúa con la nueva orden. Cerrar el panel u ocultar la app no envía una orden de parada de
pantalla; Acompañar fondo conserva su pausa al quedar oculto.

Estos contratos se probaron con dobles, incluida la recuperación, y la activación y restauración
físicas se confirmaron en la TV con las seis lámparas. El backend exige configuración privada,
`hardwareVerified`, frames frescos de PicCap y permiso de rol; no es un modo universal. El estado
y las pruebas pendientes están en [Colores de YouTube y HDMI](screen-sync.md).

## Cómo se comunica

La app llama a `luna://com.frxn.mipantalla.lights`. Su servicio Node usa UDP local, puerto 38899,
con consultas `getPilot`/`getSystemConfig` y órdenes `setPilot`. No depende de la nube WiZ ni
de un servidor en la computadora. El servicio acepta únicamente al identificador de nuestra app,
valida los parámetros y vuelve a comprobar la identidad de cada lámpara antes de escribir.

El servicio ofrece seis métodos: `capabilities`, `discover`, `getState`, `setState`, `setMode`
y `screenStatus`. Este último consulta el diagnóstico. El adaptador HyperHDR se conecta únicamente
a `127.0.0.1:19444`, autentica el token y confirma la instancia cero. La revisión consulta el
perfil, la salida y la correspondencia de las lámparas; no habilita la salida ni selecciona
una fuente de video. No admite comandos de shell, puertos ni destinos arbitrarios. El control
WiZ solo permite direcciones privadas de la red local; la selección usa identificadores.

El ejemplo público `screen-config.example.json` viene con `enabled: false` y token vacío.
La configuración privada opcional se lee de
`services/com.frxn.mipantalla.lights/screen-config.json`, excluido de Git. Sin ese archivo o con
el diagnóstico deshabilitado no se abre la conexión HyperHDR. Una configuración habilitada no
basta: hacen falta `hardwareVerified`, frames frescos de PicCap y permiso de rol hacia su
servicio. La configuración privada puede incluirse en un IPK local y no debe publicarse.

El protocolo UDP local no incorpora autenticación criptográfica. El control presupone una red
doméstica de confianza. La comprobación del emisor Luna no protege frente a quien ya tenga root.

La vista previa en Brave no descubre ni modifica lámparas reales. Las pruebas automatizadas
usan transporte y respuestas simuladas; la confirmación del brillo en las seis es una prueba
adicional en hardware, con alcance diferente.

## Empaquetar el servicio junto a la app

```sh
npm test
npm run build
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-package dist services/com.frxn.mipantalla.lights -o artifacts --no-minify
python scripts/verify_package.py
```

El verificador compara tanto los archivos de `dist/` como los del servicio; si existe
`screen-config.json`, también exige que coincida. El paquete histórico 0.6.0 verificado tenía
56 archivos y no incluía ese archivo privado opcional. El público actual 0.7.7 también tiene
56 archivos y excluye la configuración del hogar. [Pin de la descarga](local-installer.md).
La captura y restauración actuales se detallan arriba. Home y encendido directo se confirmaron
en los casos documentados de 0.7.2; eso no acredita persistencia de captura, HDMI ni DRM.
No publiques un IPK que incluya tu configuración del hogar. El código del servicio solo usa
módulos de Node disponibles en webOS 5; no agrega dependencias npm.

Referencias: [servicios JavaScript de LG](https://webostv.developer.lge.com/develop/guides/js-service-basics),
[empaquetado de servicios](https://webostv.developer.lge.com/develop/guides/js-service-usage),
[identidad del emisor Luna](https://webostv.developer.lge.com/develop/references/webos-service-reference#messagesender),
[implementación del protocolo WiZ en pywizlight](https://github.com/sbidy/pywizlight).
