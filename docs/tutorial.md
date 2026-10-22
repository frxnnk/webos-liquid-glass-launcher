# Tutorial: Mi pantalla en una LG con webOS

Guía al **2026-10-21**. Mi pantalla es una app web con servicio local: no cambia el firmware ni
las interfaces internas de YouTube, Netflix o Ajustes. Se puede usar sin root. **Home nativo,
encendido automático y captura de otras apps requieren configuración adicional**.

La **0.7.11 está instalada**, con Personalizar a la izquierda y el modo Solo fondo.
La captura sigue siendo experimental. En los checkpoints 0.7.8/0.7.9, el dueño confirmó
colores de YouTube y Home sin pantalla negra con el parche nativo verificado localmente.
Manual por API restauró 6/6; en la última prueba necesitó un segundo intento para dos luces.
El botón físico de Pantalla completa y la estabilidad prolongada siguen pendientes.
Para elegir apps y ordenar el inicio, ver [Personalizar](customizing.md).
Ver [reparación experimental y requisitos](capture-repair.md). En 0.7.6,
desde el asistente de PC, el dueño confirmó colores de YouTube en seis WiZ y se verificó
su restauración 6/6, incluidas dos en escena 6.
La aceptación general de 0.7.4 y el acceso Homebrew de 0.7.5 son antecedentes.
Los hashes y mediciones corresponden a versiones concretas, no a cualquier TV.

**Alternativa con asistente local:** el [programa de PC](local-installer.md) se inicia
con `npm run setup` y se maneja desde Brave. Su motor implementa plan, aplicación y restauración
acotada para el perfil exacto de referencia. El módulo de instalación y limpieza usa root previo;
también incorpora un [adaptador experimental de root](root-automation.md) para ese modelo,
firmware, build y board exactos. La cadena completa partiendo de una TV original no se probó:
la TV actual ya tiene root y el diagnóstico y el plan reales omiten el bootstrap. La guía siguiente
conserva el camino manual con Developer Mode. No mezclar ni repetir ambos sobre una instalación
existente sin revisar antes qué pasos necesita y qué configuraciones hay que preservar.

En la validación inicial el piloto pasó 401 pruebas y se comprobaron status, plan y un apply de privacidad idempotente
en Brave contra la TV, con respaldo real. Tras recargar, status recuperó el respaldo y restore
terminó completado; una lectura SSH separada confirmó el snapshot completo igual al inicial.
Home, instalación y bajas no se aplicaron en esa prueba. No acredita root desde cero ni arranque
físico con hooks nuevos. [Evidencia exacta](local-installer.md#qué-está-probado-y-qué-falta).

## 0. Alcance y requisitos

| Objetivo | Requisito | Estado en la TV de referencia |
| --- | --- | --- |
| Dock, fondos, clima y Transitions | Developer Mode | App probada en la TV. |
| WiZ manual y Acompañar fondo | Servicio incluido y lámparas en la LAN | Seis lámparas controladas; color del fondo confirmado. |
| Home y apertura al encender | Root/HBC persistente, configuración y recuperación | Confirmados desde YouTube y tras apagar 20 s con el control en 0.7.2. |
| Colores de otras apps | Root, PicCap, HyperHDR y configuración privada | YouTube y restauración 6/6 confirmados desde PC en 0.7.6. Botón TV 0.7.10, boot de captura, HDMI y DRM pendientes. [Detalle](screen-sync.md). |
| Menos anuncios y recolección | Ajustes y revisión de componentes | Ver [limpieza](cleaning.md); no demuestra cero telemetría. |

Hardware: **LG 49UN7310PSC, webOS 5.6.2-21, firmware 04.64.00**, board `K6LP_ATSC_BR`.
Chromium 68 según la [tabla de LG](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine).
Root depende del modelo, board y firmware exactos: no extrapolar esta unidad.

En la computadora: Git, Node.js con npm y Python. Usamos Node 24 y Python 3.13; el inventario
requiere Python con `ssl.VERIFY_X509_PARTIAL_CHAIN` y `websockets`. Computadora y TV comparten
red local. En PowerShell usar `npm.cmd` si bloquea `npm.ps1`.

El asistente de PC requiere Node 18+ y OpenSSH. Para instalar o limpiar usa root SSH en puerto 22
y `known_hosts` preparado. La ruta de root experimental exige Developer Mode accesible,
script firmado y token regular, más **Python 3.8+** al aplicar el bootstrap. No necesita Python
para abrir la UI. Su interfaz local tiene puerto dinámico y no deja un agente
de instalación permanente en la TV. [Alcance y pasos](local-installer.md).

## 1. Descargar el proyecto

```sh
git clone https://github.com/frxnnk/webos-liquid-glass-launcher.git
cd webos-liquid-glass-launcher
```

El frontend no tiene dependencias de runtime ni necesita un servidor en la computadora una vez
instalado. El CLI se obtiene con `npm exec`; no se empaqueta `node_modules`. Registrar el commit
con `git rev-parse HEAD` para reproducir una revisión concreta.

## 2. Developer Mode y emparejamiento

1. Instalar **Developer Mode** desde LG Content Store y entrar con una cuenta LG Developer.
2. Activar **Dev Mode Status**, dejar reiniciar y volver a abrir la app.
3. Activar **Key Server**. Anotar su dirección como `IP_DE_TU_TV`.

```sh
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-setup-device
```

Agregar `mi-tv`, dirección `IP_DE_TU_TV`, puerto `9922`, usuario `prisoner`. Luego:

```sh
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-novacom --device mi-tv --getkey
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-device --device mi-tv --system-info
```

Escribir la passphrase **solo en el prompt de la terminal**. No publicar llaves, passphrase ni
capturas de emparejamiento. Comprobar que modelo y firmware son los esperados. Renovar **Remain
Session** con **EXTEND** antes de vencer: LG elimina las apps de desarrollo al desactivarse
Developer Mode. Root/HBC no hace ese directorio inmune a la limpieza.
[Guía oficial](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app).

## 3. Configuración local

| Archivo | Uso |
| --- | --- |
| `config.js` | IDs, logos y orden inicial. Confirmar IDs en cada TV. |
| `weather-config.js` | Copiar `weather-config.example.js`; ciudad y coordenadas aproximadas. |
| `wallpapers.js`, `assets/wallpapers/` | Galería local y créditos. |
| `daily-photos-config.js` | Selección diaria de Commons; quitar el archivo evita esos pedidos. |
| `transitions-config.js` | Episodios de YouTube; sorteo por OK, sin repetir el último. |
| `lights-config.js` | Selección WiZ inicial opcional; también se elige desde Luces. |
| `services/com.frxn.mipantalla.lights/screen-config.json` | Captura opcional privada; no copiar una configuración ajena. |

Las configuraciones privadas de clima y luces están excluidas de Git. Sin clima válido no se
consulta Open-Meteo. Sin configuración diaria se usan fotos locales. El SVG incluido se muestra
mientras se prepara la foto. Conservar créditos y licencias al cambiar imágenes.

El acceso **Homebrew Channel** de 0.7.5 abre `org.webosbrew.hbchannel` si está instalado.
**No instala ni eleva HBC, no obtiene root y no instala paquetes al enfocar el ícono.** Se puede
ocultar en Personalizar. [Root y Home](root-and-home.md).

## 4. Probar, compilar y empaquetar

```sh
npm test
npm run build
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-package dist services/com.frxn.mipantalla.lights -o artifacts --no-minify
python scripts/verify_package.py
```

`build.cjs` arma `dist/` con una lista explícita de archivos y valida los recursos locales.
`verify_package.py` inspecciona el IPK sin ejecutarlo: ID/versión, estructura, timestamps,
archivos esperados y coincidencia byte a byte con `dist/` y el servicio. Imprime tamaño y SHA-256.
No instalar si falla. Esto no prueba permisos ni comportamiento físico de la TV.

### Paquete público fijado para el piloto

El [release v0.7.11](https://github.com/frxnnk/webos-liquid-glass-launcher/releases/tag/v0.7.11)
contiene un IPK público limpio: **63 archivos, 1.702.700 bytes**, SHA-256
`d2fa75d444c3f39d1a88766a170eb482e9f39d42f0e47d6f13ee6f5d45d5f759`.
No incluye `weather-config.js`, `lights-config.js` ni `screen-config.json`; difiere del paquete
privado instalado anteriormente. El asistente lo descarga y verifica sólo si la app está
ausente. No sobrescribe una 0.7.11 existente; actualizar otra versión está bloqueado hasta
implementar preservación. [Uso y restauración del piloto](local-installer.md).

`dist/` y `artifacts/` están ignorados. Un IPK construido con configuración privada puede
contenerla: **no subirlo como release público**. En webOS 5 la advertencia sobre `requiredACG`
no es un error de esta compilación; ver [ACG en LG](https://webostv.developer.lge.com/develop/guides/acg-guide).

## 5. Instalar y abrir

Sustituir `VERSION` por `appinfo.json` y `mi-tv` por el alias elegido:

```sh
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-install --device mi-tv artifacts/com.frxn.mipantalla_VERSION_all.ipk
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-launch --device mi-tv com.frxn.mipantalla
```

Comprobar visualmente flechas, OK, Atrás, foto y apertura de apps. Un ACK confirma aceptación,
no visibilidad. YouTube puede pedir primero elegir perfil; Transitions usa `contentTarget` con
la URL, ver [prueba del enlace](what-we-tried.md#youtube-abrir-un-video-puntual).
Ocultar en Personalizar no desinstala apps ni libera servicios del sistema.

**Al actualizar con captura/root ya configurados:** respaldar antes la configuración privada y
el rol Luna del servicio. Reinstalar puede retirar archivos/permisos añadidos fuera del IPK.
Restaurar exclusivamente el estado propio, revisar el servicio y rearmar su hook. El repo no
publica los respaldos ni el transporte privado de nuestra TV. La instalación CLI **no reproduce
por sí sola la configuración root ni la captura**.

## 6. Luces

Abrir **Luces → Buscar lámparas**, marcar solo las del living y comprobar una orden manual.
El servicio usa UDP local WiZ, sin nube ni backend en la computadora. Desconocido no significa
apagado. Buscar o mover el foco no cambia luces.

**Acompañar fondo** sigue la foto de Mi pantalla y se pausa al ocultarla. **Pantalla completa**
requiere root, PicCap/HyperHDR, configuración privada y frames frescos. No alcanza con instalar
el IPK ni con marcar `hardwareVerified`: la atestación exige probar las lámparas reales.
[Luces](lights.md) · [captura, permisos y restauración](screen-sync.md).

## 7. Root y Home: etapa avanzada separada

Referencia manual para una TV **ya rooteada**, con HBC persistente y SSH root de recuperación.
Los bloques de esta sección no son un método de root ni hay que repetir SlopBro sobre una TV ya rooteada. En esta unidad se
usó SlopBro/HBC 0.7.3; compatibilidad y revisión en [root-and-home.md](root-and-home.md).
La app debe estar instalada y abrir correctamente antes de cambiar Home.

Para el camino desde el asistente, consultar [root automático experimental](root-automation.md).
El adaptador está implementado y conserva la firma y el token de Developer Mode; detiene la
cadena si no puede verificarlos o si encuentra una operación pendiente. En la TV actual se
verificó root existente y se omitió la cadena. Las pruebas locales del adaptador no acreditan
root desde una TV original, primera confianza de huellas SSH ni un arranque físico con su startup.
El browser sigue necesitando el compañero local: no reemplaza SSH ni obtiene privilegios por sí solo.

Comprobar archivos, Node y rutas según [requisitos e instalación de Home](home-takeover.md#instalación-y-activación).
Los bloques siguientes son **POSIX/sh dentro de SSH root en la TV**, no PowerShell.

### Respaldo original

```sh
umask 077
mkdir -p /var/lib/mipantalla-maintenance/native-home
luna-send -n 1 -f luna://com.webos.settingsservice/getSystemSettings \
  '{"category":"general","keys":["defaultApps"]}' \
  > /var/lib/mipantalla-maintenance/native-home/settings-current.json
```

Abrir el JSON y exigir `returnValue: true` y `settings.defaultApps.home` válido. El anterior en
nuestra TV era `com.webos.app.fullhome`; no asumirlo en otra. Copiar la respuesta original también
a la computadora. La respuesta de LG puede omitir `category`: **no copiarla cruda como respaldo
de la guardia**, que exige `category: "general"`. Este bloque Node 8 normaliza el respaldo,
valida el anterior si existe y nunca lo sobrescribe. Solo lee/escribe archivos, sin subprocess:

```sh
/usr/bin/node - <<'JS'
'use strict';
var fs = require('fs'), dir = '/var/lib/mipantalla-maintenance/native-home/';
if (process.getuid() !== 0 || typeof fs.constants.O_NOFOLLOW !== 'number') throw Error('Requiere root y O_NOFOLLOW');
function object(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function read(name) {
  var stat = fs.lstatSync(dir + name);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw Error('Archivo inseguro');
  var fd = fs.openSync(dir + name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { return JSON.parse(fs.readFileSync(fd, 'utf8')); } finally { fs.closeSync(fd); }
}
function original(map) {
  return object(map) && typeof map.home === 'string' && map.home !== 'com.frxn.mipantalla' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(map.home);
}
var saved;
try { saved = read('settings-before.json'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!saved) {
  var current = read('settings-current.json');
  if (current.returnValue !== true || !object(current.settings) || !original(current.settings.defaultApps)) throw Error('No hay Home original confirmado');
  saved = {category:'general', settings:{defaultApps:current.settings.defaultApps}};
  fs.writeFileSync(dir + 'settings-before.json', JSON.stringify(saved, null, 2) + '\n', {flag:'wx', mode:384});
}
if (saved.category !== 'general' || !object(saved.settings) || !original(saved.settings.defaultApps)) throw Error('Respaldo anterior inválido; no continuar');
console.log('Respaldo original válido; no se modificó Home.');
JS
```

Si Home ya apunta a nuestra app y falta un respaldo anterior válido, recuperarlo antes de seguir.

### Guardia externa antes de activar Home

Transferir por el SSH configurado `scripts/tv/native-home-guard.js` a la TV, comparar SHA-256
local/remoto y ubicarlo en `/var/lib/mipantalla-maintenance/native-home/native-home-guard.js`,
fuera del IPK. Debe pertenecer a root y no ser modificable por otros usuarios. Verificar:

```sh
/usr/bin/node --check /var/lib/mipantalla-maintenance/native-home/native-home-guard.js
/usr/bin/node /var/lib/mipantalla-maintenance/native-home/native-home-guard.js
```

Con app presente devuelve `app-present` sin cambiar Home. Crear, sin reemplazar otro archivo,
`/var/lib/webosbrew/init.d/59-mipantalla-home-guard` con este contenido y modo `755`:

```sh
#!/bin/sh
/usr/bin/node /var/lib/mipantalla-maintenance/native-home/native-home-guard.js > /tmp/mipantalla-home-guard.log 2>&1
exit 0
```

La guardia intenta restaurar Home si falta la app; exige respaldo válido y readback. Su ejecución
manual con app presente **no prueba recuperación física en un arranque sin la app**.
[Contrato](home-takeover.md#guardia-externa-de-recuperación).

### Modificar únicamente Home

Preparar el siguiente tipo de JSON, copiando **todo el mapa actual de `defaultApps`** de una
lectura reciente y cambiando solo `home` a `com.frxn.mipantalla`:

```json
{"category":"general","settings":{"defaultApps":{"home":"com.frxn.mipantalla"}}}
```

**Es un esquema, no un payload para pegar**: omite los otros defaults específicos de cada TV.
Guardar el JSON completo en `native-home/home-change.json`. Ejecutar:

```sh
MI_HOME_DIR=/var/lib/mipantalla-maintenance/native-home
luna-send -n 1 -f luna://com.webos.settingsservice/setSystemSettings "$(cat "$MI_HOME_DIR/home-change.json")"
luna-send -n 1 -f luna://com.webos.settingsservice/getSystemSettings '{"category":"general","keys":["defaultApps"]}'
```

Exigir ACK y que el mapa leído completo coincida con el deseado. Crear entonces el marcador:

```sh
: > /var/lib/mipantalla-maintenance/native-home/enabled
```

Crear/ejecutar el symlink `60-mipantalla-home` con el
[bloque exacto del hook](home-takeover.md#instalación-y-activación). Si existe un watcher,
validar PID y command line antes de detenerlo: ejecutar el hook con un proceso vivo no cambia
sus argumentos. Confirmar un único watcher con `--native-home` y log `input polling disabled`.
No usar `killall node`. Este modo conserva boot y power/wake, sin polling de teclas.

`homeAutoLaunch` volvió a `on` en nuestra TV sin causa aislada: no lo usamos como garantía.
Probar YouTube → Home y apagar con control 20 s → encender, comprobando foco. Registrar por
separado otras apps, standby corto y arranque frío. Son casos distintos.

### Revertir antes de desinstalar

1. Leer `defaultApps` actual. Preparar `home-restore.json` con ese mapa, cambiando **solo `home`**
   por el valor original de `settings-before.json`.
2. Ejecutar el mismo `setSystemSettings` usando `home-restore.json`; exigir ACK y lectura completa
   coincidente. No aplicar un mapa antiguo entero sobre el estado actual.
3. Retirar `native-home/enabled`. Quitar solo nuestro symlink `60` comprobando su destino y
   terminar únicamente el watcher con PID validado. [Bloque exacto](home-takeover.md#desactivar-y-revertir).
4. Comprobar Home y encendido originales. Para retirar la guardia, quitar solo su hook y script
   verificados. Conservar el respaldo hasta terminar.

Recién después, desde la computadora:

```sh
npm exec --yes --package=@webos-tools/cli@3.2.6 -- ares-install --device mi-tv --remove com.frxn.mipantalla
```

La desinstalación completa y el fallback físico de la guardia no se probaron en esta TV.
Revertir Home no elimina root/HBC ni revierte automáticamente los ajustes de privacidad.

## 8. Inventario y limpieza

```sh
python -m pip install websockets
python scripts/inventory_tv.py --host IP_DE_TU_TV
```

Aceptar en la TV el aviso de lectura. El script consulta SSAP una vez por WSS y no guarda la
client-key. Verifica el certificado de esa conexión; la primera confianza es TOFU, no una CA
pública. Guarda `artifacts/tv-app-inventory.json`: no publicarlo crudo. `ares-install --list`
solo no alcanza para inventariar tienda/sistema. [Limpieza y reversión](cleaning.md).
Menos apps instaladas no demuestra menos CPU ni ausencia de tráfico saliente.

### Auditoría con root, solo lectura

Con Node 18+, OpenSSH, root ya disponible y la huella verificada en `known_hosts`:

```sh
node scripts/privacy-audit.cjs --help
node scripts/privacy-audit.cjs --host IP_DE_TU_TV --identity "RUTA_A_TU_CLAVE" --output artifacts/auditoria.private.json
```

Elegir una ruta de informe nueva. El script no lee la clave: se la entrega a SSH. Consulta
inventario, preferencias, memoria, disco y una muestra de CPU de dos segundos; no instala,
modifica ajustes ni descubre otros equipos. El informe reduce datos del inventario, pero
mantenerlo privado; en Windows también importan las ACL de la carpeta. Sin `--output` no guarda
un archivo. No mide FPS, inspecciona tráfico ni demuestra ausencia de telemetría. Es diagnóstico,
independiente del asistente local con acciones `plan/apply/restore`.

Con root ya configurado, hay un procedimiento separado para los
[dos permisos de reportes de LG](diagnostic-privacy.md): incluye helper acotado, respaldo,
lectura posterior y reversión. No equivale a bloquear todo el tráfico de diagnóstico.

## 9. Vista previa y siguientes pasos

```sh
npm start
node scripts/preview.cjs
```

Abrir `http://127.0.0.1:43817`; flechas, Enter y Escape simulan el control. El servidor escucha
solo loopback y **no es un instalador**. Los HTML quedan en `artifacts/mi-pantalla-preview.html`
y `artifacts/mi-pantalla-preview-tv.html`. No contactan la TV; con configuración sí consultan
clima y Commons. Revisar datos privados incrustados antes de compartirlos.

Nuvio se obtiene del [repositorio oficial](https://github.com/NuvioMedia/NuvioTVSmart/releases),
verificando compatibilidad y hash del release elegido. No redistribuimos su IPK. Su instalación
histórica no acredita que siga instalado ni login/reproducción actuales.

- [Asistente local](local-installer.md), [root experimental por modelo](root-automation.md) y [límites del navegador](browser-installer.md).
- [Visión del producto](product-vision.md) y [roadmap](roadmap.md).
- [Bitácora](what-we-tried.md) y [fuentes](sources.md).
