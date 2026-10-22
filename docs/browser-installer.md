# Asistente local y límites de instalar desde una web

**Estado al 2026-10-21: hay un piloto local implementado**, iniciado con `npm run setup` y
manejado desde Brave. Admite sólo la LG 49UN7310PSC con el firmware de referencia. Incluye una
cadena de root inicial **experimental, implementada pero no validada desde stock**, además de
operaciones que requieren root ya comprobado. No es una web estática universal.
[Guía, operaciones y validación pendiente](local-installer.md) · [camino manual](tutorial.md).

## Tres opciones

| Opción | Alcance | Límite principal | Estado |
| --- | --- | --- | --- |
| Solo navegador | Guía, configuración, descarga de archivos y quizá SSAP emparejado. | Sin SSH/TCP/UDP arbitrarios; TLS, permisos y compatibilidad del TV. | No implementado como instalador autónomo. |
| Web + compañero local | Interfaz y motor local con planes SSH, root experimental y captura. | Perfil exacto, verificación humana de huellas SSH y pruebas de hardware pendientes. | Piloto disponible mediante `npm run setup`. |
| CLI con flags de plan/apply/restore | Futuro acceso sin interfaz al mismo flujo. | Necesita un contrato público y validación propia. | No hay esos comandos CLI; hoy son acciones internas de la API local. |

El compañero escucha sólo en loopback, con puerto dinámico y sesión local. No agrega un agente
de instalación permanente en la TV ni permite una shell arbitraria desde la página. El frontend
del launcher y el instalador de PC son programas distintos; Mi pantalla está en 0.7.8; su botón Pantalla completa sigue pendiente de prueba física.

## Qué impide hacerlo todo con JavaScript en el browser

### SSAP no es SSH ni el instalador de paquetes

LG usa WebSocket para su control remoto en red. El código de Connect SDK abre `wss://TV:3001`,
registra un cliente y contempla permisos/emparejamiento. En esta TV el inventario funcionó por
WSS; el canal sin TLS al puerto 3000 cerró durante el upgrade. Eso no demuestra que todos los
modelos se comporten igual. [Cliente oficial de LG](https://github.com/ConnectSDK/Connect-SDK-Android-Core/blob/master/src/com/connectsdk/service/webos/WebOSTVServiceSocketClient.java).

Una conexión SSAP autorizada permite las operaciones que expone y autoriza ese servicio.
**No otorga una shell root ni equivale al protocolo usado por `ares-install`.** La lectura de
apps de nuestro script solo solicita `READ_INSTALLED_APPS`. No corresponde inventar un método
SSAP de instalación universal a partir de que podamos abrir una app.

La API `WebSocket` del navegador acepta sus esquemas de URL y mensajes WebSocket; no expone una
conexión TCP sin protocolo a SSH ni una API UDP para WiZ. Una implementación de SSH en JS
necesitaría un transporte puente compatible: eso ya sería otra pieza instalada, no browser-only.
[Interfaz WebSocket](https://websockets.spec.whatwg.org/#the-websocket-interface).

### Certificado del televisor

El navegador valida TLS de WSS según su plataforma. El constructor WebSocket no tiene una opción
para ignorar certificados o instalar una CA a demanda. No alcanza con copiar al browser nuestro
script Python: ese script controla su contexto TLS, fija el certificado de esa conexión y
comprueba el peer; una página web no recibe esa misma interfaz.
[Handshake WebSocket](https://websockets.spec.whatwg.org/#websocket-opening-handshake).

No validamos una ruta de emparejamiento browser → WSS en esta TV. No proponer desactivar la
seguridad global del navegador ni instalar un certificado indiscriminadamente. El certificado,
la identidad del dispositivo y el permiso en pantalla son verificaciones diferentes.

### HTTPS, CORS, CSP y red local

Una web pública HTTPS que intenta acceder a la LAN está sujeta a controles adicionales. Hay que
probarlos en cada navegador soportado; no suponer que Chromium 68 de la TV funciona igual que el
Brave de la computadora.

- **Contenido mixto:** HTTP/WS desde un contexto HTTPS puede bloquearse. Las excepciones y los
  mecanismos de acceso local dependen del navegador y su implementación; no dar por hecho una
  excepción para cualquier dirección privada. [Mixed Content](https://www.w3.org/TR/mixed-content/).
- **CORS:** leer respuestas HTTP de otro origen requiere cooperación del servidor en los casos
  que establece Fetch. `mode: 'no-cors'` devuelve una respuesta opaca; no es una solución para
  inspeccionar inventarios, confirmar instalación o verificar errores.
  [Fetch/CORS](https://fetch.spec.whatwg.org/#http-cors-protocol).
- **WebSocket:** no usa el mismo mecanismo de autorización CORS que `fetch`; el handshake incluye
  el contexto de origen y el servidor puede rechazarlo. Agregar un header CORS por sí solo no
  arregla certificados, emparejamiento ni permisos SSAP.
  [Handshake](https://websockets.spec.whatwg.org/#websocket-opening-handshake).
- **CSP:** `connect-src` también restringe conexiones WebSocket. Abrirlo a `*` no resuelve las
  demás restricciones y ampliaría innecesariamente los destinos de una futura herramienta.
  [CSP3](https://www.w3.org/TR/CSP3/#directive-connect-src).
- **Acceso a la red local:** la propuesta actual Local Network Access reemplaza el trabajo
  anterior llamado Private Network Access y añade un permiso. Es una especificación en
  evolución; comprobar soporte y comportamiento real por versión. No confundirla con un CORS
  preflight universal ni asumir que aprobar ese permiso habilita SSH.
  [Especificación](https://wicg.github.io/local-network-access/) ·
  [explicación](https://github.com/WICG/local-network-access/blob/main/explainer.md).

El acceso directo de una web a la TV con esos protocolos **no se ensayó** como instalador.
El piloto evita esa ruta: la página habla con su servidor local y OpenSSH conecta con la TV.
Eso no convierte el soporte de red de la página en soporte SSH ni elimina el emparejamiento.

### Root sigue siendo una operación por compatibilidad

Un exploit que usa una página como parte de su entrega no convierte esa página en una API
normal de instalación ni en un método universal. En la unidad de referencia se revisó SlopBro
para un firmware concreto y se obtuvo root/HBC. Ese procedimiento tuvo recuperación y permisos
propios; el ACK de descarga no acreditaba root. [Registro de lo ejecutado](root-and-home.md).

El piloto ahora tiene **Revisar root**, **Preparar root** y **Aplicar root revisado**. Preparar
sólo consulta y muestra el plan; aplicar ejecuta una cadena propia y acotada, con fuentes
fijadas, conservación de Developer Mode y reserva exclusiva persistente por host. La TV ya
rooteada se omite. Ningún exploit se inicia al abrir la página o consultar el estado.

La ruta upstream investigada produjo un error de firma de Developer Mode que necesitó
recuperación manual. La cadena nueva **todavía no fue validada de punta a punta sobre una TV
original**. Las huellas SSH iniciales de los canales nuevos no se aceptan automáticamente:
requieren verificación humana, y una interrupción queda pendiente de recuperación. No se
repite root, no se degrada firmware y no se anuncia «un clic y listo».
[Registro y recuperación](root-and-home.md).

## Qué hace el piloto actual

La interfaz nueva incluye ayuda del archivo de identidad y **Buscar claves en esta PC**.
Encuentra rutas conocidas por metadatos y referencias privadas previas sin abrir las claves.
La selección es explícita: no usa el PIN de Developer Mode, no pide pegar la clave y no guarda
su contenido en el browser. OpenSSH y, para root, `ssh-keygen` usan el archivo local.

El motor implementa `status`, `plan`, `apply` y `restore` detrás de la interfaz; no son flags CLI.
El plan vence en cinco minutos y se vuelve a validar antes de escribir. Los pasos tienen journal
privado y respaldo local/remoto. Una consulta de recuperación busca el destino original sin
repetir automáticamente una operación que terminó con timeout.

Puede instalar el IPK público 0.7.8 si la app falta, preparar Home y sus hooks propios, aplicar
el perfil acotado de privacidad y retirar sólo tres apps LG elegidas. Con 0.7.8 presente omite
la instalación; otra versión bloquea ese paso hasta resolver preservación de actualizaciones.
Restaurar no reinstala apps retiradas ni desinstala automáticamente un paquete nuevo.
[Guía exacta, release fijado, SHA-256 y límites](local-installer.md).

La tarjeta de luces tiene **Revisar captura**, **Preparar captura**, **Activar** y **Desactivar**.
Preparar puede instalar los paquetes fijados y configurar PicCap/HyperHDR; activar requiere las
pruebas de captura y hardware de esta unidad. Desactivar usa el baseline propio para restaurar
las lámparas, incluso tras una sesión pendiente. En 0.7.6 el dueño confirmó colores de YouTube
en seis WiZ y una lectura independiente verificó su restauración 6/6 al desactivar, incluidas
dos en escena 6. Un ACK solo no acredita esos resultados. [Recorrido](local-installer.md#luces-siguiendo-el-video).

La 0.7.8 espera la habilitación efectiva de `LEDDEVICE` y corrige el estado activo/preparado
en la UI de la TV. La confirmación anterior desde PC no valida el botón Pantalla completa
de esta versión: esa prueba física sigue pendiente. [Corrección y alcance](screen-sync.md).

La 0.7.8 exige el [parche nativo experimental](capture-repair.md) para iniciar captura.
Preparar no lo instala automáticamente: PicCap oficial sin ese parche no habilita Start.

`scripts/privacy-audit.cjs` continúa siendo un CLI separado de sólo lectura. No instala ni
modifica ajustes. [Uso](tutorial.md#auditoría-con-root-solo-lectura).
`scripts/serve.cjs` sirve únicamente la vista previa; el asistente usa `installer/server.cjs`.

El piloto anterior pasó **401/401 pruebas**. En Brave se verificaron `status` y `plan`
contra la TV y un apply de privacidad idempotente, con respaldo real y snapshot final igual al
inicial.
Tras recargar Brave se recuperó el respaldo por `status` y se restauró. Una lectura SSH
separada confirmó journal `restored` y snapshot completo idéntico al previo. No se aplicaron
Home, instalación ni bajas; no se probó el IPK público en la TV ni partir de una TV original.
En las comprobaciones focales anteriores, la interfaz pasó 33 pruebas locales y root/reservas,
42. La suite completa actual pasó **555/555**; esos resultados locales no acreditan
root-stock ni arranque físico. Usar una instancia por TV: la reserva entre procesos cubre root,
no todos los cambios, y los journals no prueban tolerancia a pérdida total de alimentación.
[Validación y límites](local-installer.md#qué-está-probado-y-qué-falta).

## Qué sigue pendiente

- Probar cambios desde valores originales y su restore, sin heredar pruebas del camino manual.
- Ensayar Home, instalación ausente y bajas permitidas, incluidos sus límites de recuperación manual.
- Probar corte de red, resultados inciertos, reanudación y restauración parcial.
- Actualizar otra versión preservando configuración privada y roles root existentes.
- Ampliar la matriz sólo con pruebas por modelo y firmware; el perfil actual es uno solo.
- Probar Home con app ausente durante boot y restauración física del destino anterior.
- Validar la cadena experimental de root desde stock, con huellas SSH verificadas, recuperación
  e inicio físico; no repetir ese recorrido sobre una TV que ya tiene root.
- Probar persistencia de captura tras reinicio, HDMI y contenido protegido.
- Confirmar desde el botón Pantalla completa de la TV la activación y parada de 0.7.8.

El release público 0.7.8 sin configuración del hogar ya está disponible y su SHA-256 queda fijado
en el motor. Tener ese paquete y las acciones implementadas no demuestra todavía un recorrido
completo de instalación y restauración sobre una TV original.
