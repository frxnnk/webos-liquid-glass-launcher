# Mi pantalla

> **0.7.11 instalada** (22 de octubre de 2026): al volver a Manual, las lámparas que no confirman la
> restauración se reintentan una vez tras 1,5 s antes de dejarlas pendientes, y los filos del vidrio
> son algo menos brillantes. No se validó con la TV física ni el dueño volvió a probar la captura;
> HyperHDR pide renovar su autorización (ver [Captura](docs/screen-sync.md#renovar-la-autorización-de-hyperhdr)).
>
> **0.7.10:** Personalizar queda arriba a la izquierda. **Solo fondo** muestra la
> galería a pantalla completa; OK, Atrás o una flecha recuperan la interfaz.
> [Apps, orden y modo Solo fondo](docs/customizing.md).
> La captura sigue siendo experimental: el dueño confirmó colores de YouTube con 0.7.8;
> Home con captura activa llegó al launcher en 0.7.9 y el dueño confirmó imagen normal.
> STOP ya no depende de respuestas WiZ mientras HyperHDR escribe. La última restauración
> necesitó dos intentos de Manual y terminó con 6/6 estados exactos, verificados por UDP.
> Captura apagada y sin recuperación pendiente al cerrar. Suite 0.7.11: **651/651**.
> [Captura y límites](docs/screen-sync.md) · [Incidente previo](docs/incidents/2026-10-21-black-screen.md).

Un inicio personalizado para LG webOS: tus apps, fotos y el control del living en una pantalla
Liquid Glass que se maneja con el control remoto.

**0.7.11 instalada.** Las apps del inicio pueden elegirse y ordenarse desde Personalizar.
Los accesos que exceden el ancho se recorren con las flechas; HDMI queda en su sección.
Conserva Homebrew Channel y el auditor de privacidad y recursos de sólo lectura.

En la **0.7.6**, desde el asistente de PC, el dueño confirmó
que las seis lámparas siguen los colores del video de YouTube. **Desactivar restauró las seis**,
incluidas las dos en escena: el estado se contrastó de forma independiente con el original.

Después, el botón de la TV expuso una carrera: HyperHDR aceptaba una orden encolada antes de
confirmar `LEDDEVICE`. La **0.7.7** espera el estado efectivo y separa captura activa de preparada
en la UI. Tras activar o volver a Manual hace una sola consulta de estado. El dueño confirmó
que las luces siguen los colores del video; después apareció el incidente de pantalla negra.
Esa confirmación no acredita estabilidad ni restauración de luces con 0.7.7.

Checkpoint de telemetría posterior: sesión nativa `active`, salida LED encendida y frames frescos
con YouTube en primer plano a unos **28,5 FPS**. Dos lecturas UDP separadas 3 s encontraron las
seis WiZ encendidas; tres cambiaron RGB/brillo. La sesión apareció tras solicitar la prueba,
sin activarla desde PC. El dueño confirmó los colores después; esto no acredita escenas,
latencia ni Stop normal de 0.7.7. La imagen se recuperó tras desenchufar 60 s y una recuperación
offline posterior restauró las seis luces al baseline exacto. Un único Home con ambos
capturadores apagados llegó a Mi pantalla según foreground; el dueño confirmó que el inicio se ve bien.
La causa y una corrección permanente siguen pendientes.

[**Tutorial completo**](docs/tutorial.md) · [Privacidad y limpieza](docs/privacy-cleanup.md) ·
[Funciones futuras](docs/product-vision.md) · [Instalador desde el navegador](docs/browser-installer.md)
· [Próximos pasos: rendimiento, referencias visuales, Flutter y wizard local](docs/next-steps.md)

## Qué ofrece hoy

- Catálogo de apps con acceso propio instalado en la TV, con selección y orden guardados.
  [Personalizar](docs/customizing.md) conserva las preferencias anteriores y funciona con el
  último catálogo guardado si falla la consulta. Los accesos iniciales son YouTube, Spotify, Nuvio, Netflix, Disney+,
  Transitions/Bedrock, Homebrew Channel y HDMI 1. Los IDs se verifican por modelo: un acceso
  configurado no significa que la app esté instalada. Nuvio 1.2.9 se instaló el 22 de octubre de 2026
  (inventario: `space.nuvio.webos`); login y reproducción no se verificaron.
- Modo **Solo fondo**: foto a pantalla completa, sin textos ni controles. Mantiene la
  rotación de la galería; la primera tecla de salida sólo recupera la interfaz.
- Ilustración local desde el primer pintado, foto con fundido y una selección diaria de
  Wikimedia Commons con créditos y licencia. Las fotos incluidas funcionan sin esa descarga.
- Clima de la ciudad configurada con Open-Meteo, caché local y estados de dato viejo o sin red.
- Un episodio aleatorio de John Digweed Transitions en YouTube. Puede aparecer primero el
  selector de perfiles de YouTube; ese paso pertenece a esa app.
- Luces WiZ por red local: selección del living, encendido, brillo, color, blancos y
  acompañamiento del fondo de Mi pantalla.
- Home nativo y apertura al encender mediante configuración root separada, con respaldo,
  watcher de potencia y una guardia externa de recuperación.

Mi pantalla es una app, no un firmware. No reemplaza Ajustes ni las interfaces internas de
las apps. El Home original sigue instalado como opción de recuperación.

## Compatibilidad y evidencia

La unidad de referencia es **LG 49UN7310PSC**, webOS **5.6.2-21**, firmware **04.64.00**,
Chromium **68**. El frontend conserva ES5 y no necesita un servidor en la computadora después
de instalarlo. La app y el control manual WiZ pueden usarse con Developer Mode; Home nativo y
captura de otras apps requieren root y configuración adicional.

- El dueño probó **0.7.4** y confirmó que anda bastante bien.
- En **0.7.2**, confirmó Home desde YouTube y encendido tras apagar 20 segundos directamente
  en Mi pantalla. No se extiende a todos los modelos ni ciclos de standby.
- La **0.7.5** se verificó en Brave a 1920×1080 y 1280×720 y se instaló en la TV. Se comprobó
  Homebrew en primer plano después de abrirlo desde el nuevo acceso.
- La muestra de navegación rápida 0.7.5 registró aproximadamente **59,7 FPS** por CDP.
  No es un tiempo desde el encendido ni una garantía de FPS para todos los escenarios.
- PicCap 0.5.3 y HyperHDR 22.0.1 se reinstalaron; PicCap informa captura de UI y video a
  **29,44–29,5 FPS** con YouTube abierto por el dueño. Se recuperaron el perfil histórico de
  las seis WiZ y el servicio propio con UID 0. La 0.7.6 corrigió el bloqueo anterior de las
  lámparas en escena 6; Brave mostró sincronización activa y el dueño confirmó que siguen los
  colores del video. Desactivar devolvió las seis al estado original, incluidas las dos escenas,
  con lectura independiente de encendido, brillo, RGB, temperatura e identificador de escena.

[Mediciones y método](docs/performance.md) · [Home y reversión](docs/home-takeover.md) ·
[Luces y sus límites](docs/lights.md) · [Captura](docs/screen-sync.md)

## Instalar

`npm run setup` (`npm.cmd run setup` en PowerShell) inicia el **asistente local para Brave**,
limitado al modelo y firmware de referencia. La interfaz explica la clave SSH, busca archivos
conocidos sin leer su contenido y permite revisar planes de instalación, Home, privacidad y
tres bajas LG opcionales, con respaldo y restauración acotada. También incorpora los controles
de captura de video y luces. [Guía del asistente](docs/local-installer.md).

**Root automático experimental:** hay una cadena implementada con Preparar/Revisar/Aplicar,
fuentes fijadas y protección contra ejecuciones simultáneas para el mismo host. **No está
validada de punta a punta sobre una TV original ni mediante arranque físico.** Una TV ya
rooteada se omite. Las huellas SSH nuevas requieren verificación humana; el asistente no las
acepta a ciegas ni reintenta una operación incierta. [Alcance y límites](docs/browser-installer.md).

El piloto anterior pasó **401 pruebas**. En Brave contra la TV se verificaron conexión/plan y aplicación
idempotente de privacidad, con respaldo real. Tras recargar se recuperó ese respaldo y se
restauró; otra lectura SSH confirmó el snapshot completo igual al inicial. Home, instalación
y bajas no se aplicaron con ese piloto. La suite completa de la versión actual pasó
**555/555 pruebas**. Esto no prueba root desde cero ni el botón físico de 0.7.7. La confirmación
de colores y restauración 6/6 corresponde al checkpoint 0.7.6 desde el asistente de PC.
Reinicio de captura, HDMI y contenido protegido siguen pendientes.

El [tutorial](docs/tutorial.md) incluye Developer Mode, emparejamiento, configuración, paquetes,
Home manual, recuperación y desinstalación. Para la parte local:

```sh
git clone https://github.com/frxnnk/webos-liquid-glass-launcher.git
cd webos-liquid-glass-launcher
npm test
npm run build
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-package dist services/com.frxn.mipantalla.lights -o artifacts --no-minify
python scripts/verify_package.py
```

No instalar si falla la verificación. El tutorial explica la conexión `mi-tv` y el comando
`ares-install`. En PowerShell usar `npm.cmd` si la política bloquea `npm.ps1`.

Las configuraciones del hogar no se publican: `weather-config.js`, `lights-config.js` y el
`screen-config.json` del servicio están excluidos de Git. Los ejemplos son una guía; no copiar
tokens, direcciones de lámparas ni atestaciones de hardware de otra TV. Antes de actualizar una
instalación root existente, respaldar y preservar su configuración y permisos específicos.

## Privacidad y limpieza

En la TV se volvieron a leer apagadas las preferencias de promociones, Live Plus, anuncios
personalizados, anuncios del salvapantallas y cookies publicitarias. Se mantienen ausentes
LG Streaming Week, LG Sports Playbook y LG Channels. No se apagaron a ciegas servicios del
sistema ni se purgaron logs. [Acciones y reversión](docs/cleaning.md).

También se retiraron Apple Music, Apple TV, DGO y Star+ por selección del dueño, conservando
las seis apps que indicó y las herramientas principales: el inventario quedó en 117 apps.
Los permisos `analyticsLog` y `crashLog` de LG quedaron en `false`, con respaldo y lectura
posterior. Hay un hook de reaplicación probado manualmente; el arranque físico posterior
está pendiente. [Helper, procedimiento, límites y reversión](docs/diagnostic-privacy.md).

Auditamos **Life’s Good Without Spying**, la app del catálogo Homebrew. Su versión revisada
aplica el conjunto de opciones al cambiar un toggle; los defaults incluyen voz y purga.
No se habilitó. [Código revisado, riesgos concretos y perfil propuesto](docs/privacy-cleanup.md).

También publicamos un auditor de sólo lectura para una TV con SSH root ya autorizado:

```sh
node scripts/privacy-audit.cjs --help
node scripts/privacy-audit.cjs --host IP_DE_TU_TV --identity RUTA_A_TU_CLAVE
```

No obtiene root, instala apps, cambia ajustes ni descubre equipos. Informa preferencias
conocidas, inventario resumido, Home, memoria, disco y una muestra breve de CPU. Exige verificar
el host SSH y no lee la clave; el JSON opcional se crea sólo con `--output`. Mantener los
informes y respaldos privados. El script se probó sobre la TV real.

**Apagar anuncios no demuestra cero telemetría.** LG y las apps de streaming conservan sus
propias conexiones y acuerdos. Nuestra UI consulta Commons y Open-Meteo cuando se configuran
esas funciones; WiZ usa la LAN. Se describe cada límite en la guía de privacidad.

## Hacia dónde seguir

Priorizamos un dock con inventario y recientes locales, un panel de estado/privacidad con
recuperación y escenas WiZ con confirmación y deshacer. Son propuestas con requisitos y
criterios de aceptación, no funciones anunciadas como terminadas.
[Visión del producto](docs/product-vision.md) · [Roadmap](docs/roadmap.md).

El piloto local tiene una interfaz inspirada en Apple TV y motor con plan, respaldo, aplicación
y restauración. El camino de root inicial es experimental y admite un único perfil; instalar,
optimizar y controlar la captura requiere acceso root comprobado. El rediseño es del asistente
de PC; la 0.7.7 instalada conserva el dock del launcher y actualiza el control de luces.
[Guía del piloto](docs/local-installer.md) · [límites del navegador](docs/browser-installer.md).

## Documentación y procedencia

- [Tutorial de principio a fin](docs/tutorial.md).
- [Asistente local, claves SSH, root experimental y luces](docs/local-installer.md).
- [Qué falló y cómo se resolvió](docs/what-we-tried.md).
- [Root y recuperación](docs/root-and-home.md).
- [Limpieza ejecutada](docs/cleaning.md) y [auditoría de privacidad](docs/privacy-cleanup.md).
- [Rendimiento](docs/performance.md), [Luces](docs/lights.md) y [captura](docs/screen-sync.md).
- [Fuentes](docs/sources.md) y [licencia](LICENSE).

El diseño original y el primer tutorial se trabajaron con Claude Opus 5.5 high. Las
integraciones y el rework 0.7.4 se terminaron con Codex; Opus no pudo iniciarse en esa sesión.
No hay afiliación con LG, WiZ ni las marcas de los accesos.
