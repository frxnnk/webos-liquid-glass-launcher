# Reparación experimental de la captura: 0.7.8

La 0.7.8 es una candidata para la **LG 49UN7310PSC, firmware 04.64.00,
webOS 5.6.2-21 y placa K6LP_ATSC_BR**. No es una corrección oficial de PicCap.
El incidente de pantalla negra está documentado [por separado](incidents/2026-10-21-black-screen.md).

## Qué encontramos

El capturador incluido en PicCap 0.5.3 corresponde al commit
`00c932f092084b234b3f619b060a98fa134c12bd` de `webosbrew/hyperion-webos`.
Un hilo podía terminar la captura mientras otro todavía usaba un buffer prestado
por el driver. Reprodujimos ese defecto con el `unicapture.c` original y un backend
de prueba: hubo tres violaciones del tiempo de vida del cuadro. Esto demuestra
una carrera local; no demuestra que haya causado el bloqueo del kernel de esta TV.

El parche hace que un solo hilo sea dueño de esperar, adquirir, convertir, enviar,
liberar y terminar cada captura. Stop espera a ese hilo sin liberar buffers por su
cuenta. Un mutex protege las solicitudes de parada, los estados públicos y los FPS.
Los FPS vuelven a cero al iniciar y al completar la parada, para no presentar una
medición de la sesión anterior como si fuera video nuevo.

En Mi pantalla también corregimos el ciclo completo:

1. Revisar distingue «lista para iniciar» de «cuadros actuales confirmados».
2. Antes de iniciar se guarda el estado original de las lámparas en el WAL privado.
3. Se inicia PicCap, se comprueban cuadros y recién después se habilita la salida LED.
4. Manual detiene PicCap, confirma la parada, deshabilita LED y restaura las lámparas.
5. Una respuesta tardía no puede reanudar el inicio ni habilitar LED. Un inicio nativo
   incierto conserva la recuperación pendiente; su ACK tardío permite una compensación.
6. Un WAL `prepared` encontrado al reiniciar el servicio se trata como incierto.
   Manual no puede borrarlo basándose solamente en una lectura OFF; requiere recuperación
   comprobada sin escritores activos.

La preparación también compensa un comportamiento del setter oficial de PicCap: guardar
ajustes reinicia su proceso aun con `autostart: false`. Después de ese setter propio se
solicita Stop y se comprueban las cuatro señales OFF antes de informar éxito. El nuevo token
de ejecución sólo se entrega a la app después de esa comprobación. Un timeout no acredita
la parada: conserva el resultado incierto y puede requerir recuperación independiente.

La espera de la UI es de hasta 25 segundos para iniciar o detener este modo. Vencer
ese plazo no cancela una orden ya enviada ni acredita que las luces estén restauradas.
El WAL se conserva mientras no haya confirmación suficiente.

## Parche y reproducción

El código, la licencia MIT, los hashes, el aplicador y las pruebas están en
[`native/capture/`](../native/capture/README.md). La versión nativa es
`00c932f-mipantalla-single-owner1`. La integración exige esa versión para iniciar;
Stop sigue disponible para recuperar una instalación anterior.

Los comandos locales no acceden a la TV:

```sh
sh native/capture/run-tests.sh upstream  # debe demostrar el fallo original
sh native/capture/run-tests.sh           # aplica el parche exacto en una copia temporal
SANITIZE=address sh native/capture/run-tests.sh
```

Para compilar el árbol completo se usó la receta ARM del upstream fijado:

- SDK `openlgtv/buildroot-nc4`, release `webos-b17b4cc`.
- Archivo `arm-webos-linux-gnueabi_sdk-buildroot.tar.gz`.
- SHA-256 `1f69af43caac4b6898d8f0323c975be60af04abdd1e1c144773072b28c961c20`.
- Submódulo `tv-native-apis`: `4a4876569f9408cb404398f896e21c2ecda0af81`.
- libyuv: `fdc71956bdade0012b0628b5011b567c06c72308`.
- flatcc: `29201734bf2d12713a7a1a035d31e5123aac9c93`.

Después de verificar el SDK y ejecutar su `relocate-sdk.sh`, se prepara una copia
descartable del árbol original con `prepare-source.py`. La compilación usa:

```sh
cmake -S COPIA_FUENTE -B BUILD -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=RUTA_SDK/share/buildroot/toolchainfile.cmake
cmake --build BUILD --target hyperion-webos gm_backend halgal_backend dile_vt_backend vtcapture_backend -j 4
```

El binario ARM de esta candidata tiene SHA-256
`3e015c40f7dffeaa19cf27115c2df188f598820d68ed128654a06b247a24f161`.
El hash identifica esta compilación; no promete una compilación bit a bit idéntica
en otra ruta o entorno, porque el ejecutable conserva información de depuración.

## Instalación de referencia y límites

Se respaldaron los bytes oficiales, la definición LS2, el rol y los ajustes de PicCap.
La candidata y los cuatro backends oficiales verificados se guardaron en una carpeta
privada de root, con directorio `0700` y ejecutables `0500`. Sólo se cambió la ruta
del ejecutable en la definición y el rol de ese servicio. No se ampliaron permisos
LS2 ni se modificaron drivers propietarios, quirks o módulos del kernel.

La comprobación ABI con `--version` terminó correctamente en la TV. El servicio nuevo
informó la versión esperada, root y captura apagada. Esto todavía no acredita video,
Home, rendimiento ni estabilidad. El instalador público no aplica este parche nativo
de manera automática.

La 0.7.8 se instaló preservando la configuración privada y recuperando su definición root.
`screenStatus` informó seis lámparas, configuración y hardware verificados,
`captureStartReady: true`, `framesVerified: false`, salida LED apagada y ningún WAL pendiente.
Eso habilita una prueba nueva; no se anotó como sincronización física confirmada.

Después apareció una sesión activa con YouTube en primer plano, salida LED habilitada y
captura de UI a unos **24,8 FPS**. No se atribuye su activación a una orden de este diagnóstico.
En esa muestra `videoRunning` era `false`; dos consultas de luces muy próximas no mostraron
cambios entre ellas. Eso no acredita seguimiento de colores del video.

Una orden Manual por la API de Mi pantalla terminó correctamente: PicCap quedó apagado,
UI y video detenidos, desconectado y a 0 FPS. Se restauraron **6/6 estados exactos** contra
el WAL de esa sesión mediante consultas UDP independientes; las seis quedaron encendidas y
el WAL se resolvió. Luego un único Home, con captura apagada, devolvió Mi pantalla como
foreground. No se recibió aún una confirmación visual de esta prueba y no se probó Home
con captura activa. El incidente original sigue abierto.

ThreadSanitizer no quedó acreditado: el runtime de WSL abortó antes de las pruebas
con `unexpected memory mapping`. ASan y UBSan sí se ejecutaron sobre el harness local.

El wait existente de VTC puede demorar unos diez segundos cuando no cambia el buffer.
Un syscall propietario bloqueado en estado `D` sigue sin una cancelación segura demostrada.
La prueba física debe cubrir video, Manual, restauración y Home por separado. HDMI,
contenido protegido, standby y estabilidad prolongada siguen pendientes.
