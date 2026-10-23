# Navegación y arranque: 0.7.0

La lentitud se reprodujo en la propia TV, con Chromium 68 a 1920×1080. Cada foco regeneraba dos
gradientes de pantalla completa y animaba varias sombras y capas durante 200–600 ms. Además,
se pedía un desplazamiento del dock después de cambiar el foco, aunque ya entraba en pantalla.

En TV ahora el foco cambia al instante, con borde blanco y escala visibles. Se conservan el
vidrio estático, los logos, las fotos, su fundido y el clima. La vista previa de escritorio
mantiene los efectos originales. Personalizar conserva el desplazamiento de sus listas.

## Medición

Se simularon flechas cada 120 ms durante 3,5 segundos y se registraron los intervalos entre
callbacks de `requestAnimationFrame`. Las mediciones A/B temporales se retiraron al terminar.

| Prueba en la TV | Intervalos | Media entre cuadros | Percentil 95 |
| --- | ---: | ---: | ---: |
| Versión anterior, repetición de la prueba | 26 | 127,56 ms | 383,32 ms |
| Solo sin halos de pantalla completa | 93 | 38,17 ms | 100,00 ms |
| 0.7.0 instalada, sin estilos de diagnóstico | 209 | 16,75 ms | 16,67 ms |

En la última muestra hubo un intervalo mayor de 25 ms; el máximo fue 33,33 ms. El percentil 95
del manejador de teclado fue 13,7 ms. Esto acredita esa prueba de navegación con entradas
simuladas, no garantiza 60 FPS en todas las situaciones ni sustituye la prueba con el control.

El dueño probó después las flechas con el control y confirmó que la UI responde bien.

No se atribuye esta mejora a borrar aplicaciones. En una muestra de CPU de cinco segundos,
el watcher consumió aproximadamente 1,4 % de un núcleo y la CPU global estuvo cerca de 5,2 %.
La carga media del sistema era alta, pero no demostraba por sí sola saturación de CPU.

## Encendido

Se conservó el hook de HBC. El watcher usa 100 ms por defecto y comparte un único lanzamiento
entre Home, arranque y despertar. Una aceptación cancela los reintentos; un despertar ya no
provoca cuatro aperturas incondicionales. Se corrigió la acumulación que podía convertir una
demora corta del heartbeat en un despertar falso.

La primera prueba de standby de 0.7.0 falló: Quick Start mantenía vivo el proceso y no aparecía
un salto de reloj. La 0.7.1 agrega una suscripción al estado real de energía. Una transición
de estado no activo a `Active` solicita la apertura; el primer estado recibido solo establece
la referencia. Reconecta si falla el servicio y conserva el salto de reloj como respaldo.

En la limpieza anterior se desactivó `general.homeAutoLaunch`; en la lectura posterior de la
0.7.2 volvió a aparecer `on`. Se volvió a dejar en `off` y se comprobó la lectura, pero tras las
pruebas del usuario apareció nuevamente en `on`. No se aisló la causa ni se acredita que `off`
persista. El destino `defaultApps.home` sí conservó Mi pantalla. El hook de
Mi pantalla sigue necesitando que webOS y su administrador de aplicaciones estén disponibles:
no reemplaza la pantalla de arranque del firmware. El dueño confirmó en 0.7.1 que, después de
apagar con el control durante 20 segundos y encender, Mi pantalla abre sola; también confirmó
que Home desde YouTube vuelve a Mi pantalla. No se midió la cantidad de cuadros de HDMI que
puedan aparecer antes de cargar la app. Más detalle en [Home](home-takeover.md).

La 0.7.2 configura `general.defaultApps.home` para que el compositor abra Mi pantalla directamente
al soltar Home. Con `--native-home`, el watcher conserva arranque y potencia, pero deja de abrir
dispositivos de entrada y de revisarlos cada 100 ms. La prueba automática desde YouTube volvió
a Mi pantalla sin una nueva detección del watcher. El dueño confirmó después que Home desde
YouTube va directo a Mi pantalla y que apagar 20 s con el control y encender también abre Mi
pantalla directamente. Son confirmaciones de esos casos: no se midió la latencia ni se revalidó
un arranque en frío con esta configuración.

Las tres apps LG retiradas, los ajustes publicitarios adicionales y su recuperación están en
[Limpieza](cleaning.md).

## 0.7.3: primer fondo

La 0.7.3 está instalada y `ares-launch` aceptó su apertura. Las mediciones siguientes son
`Page.reload` por CDP en la TV real, con tiempos relativos a `performance.now()`. **No miden
desde power-on ni acreditan un arranque físico en frío.** La prueba perceptual del usuario sigue pendiente.

En la referencia anterior se cargó primero un JPEG local y, después de mostrarlo, se pidió la
foto del día. Estas son las marcas anteriores, en milisegundos desde el inicio de esa medición:

| Etapa de referencia | Marca o duración |
| --- | ---: |
| Solicitud del JPEG local | 717 ms |
| Carga del JPEG local | 1.085 ms |
| Decode del JPEG local | 1.407 ms |
| Vidrio/frente local | 1.773 ms |
| Foto local completamente opaca | 2.861 ms |
| Solicitud de la foto del día | 3.177 ms |
| Duración de esa solicitud | 20,1 ms; `cacheDisk: true` |
| Decode de la foto del día | 3.373 ms |
| Foto del día al frente | 3.524 ms |

La foto del día de esa muestra ya estaba en la caché HTTP del navegador; también existía la
metadata diaria. El tiempo observado incluía el orden de carga local → remota, decode, vidrio
y fundido. Esa evidencia no demuestra que todas las fotos estén descargadas ni una falla de red.

La implementación monta `Daily.mount` antes de los fondos y entrega su caché válida
síncrona como `Backgrounds.initialList`. Restaura directamente la última foto del día validada;
la primera carga evita la espera de `decode()` y el fundido inicial. Las rotaciones posteriores
conservan su fundido. La primera remota tiene límite de 1.500 ms y su primer fallo vuelve de
inmediato a la base local; sin galería diaria válida en caché, la primera local también es inmediata.

Se reutilizan metadata y caché HTTP existentes, sin introducir IndexedDB ni convertir los assets.
Se conservan créditos, licencias, renovación diaria y acompañamiento de color. No cambia Home.

### Resultado con la misma foto diaria en caché

La primera solicitud fue directamente la foto del día, sin JPEG local previo, con
`fromDiskCache: true` y sin `decode()` para esa primera imagen:

| Etapa 0.7.3 | Marca |
| --- | ---: |
| Asignación de la foto diaria | 804 ms |
| Carga | 906 ms |
| Foto diaria al frente | 1.255 ms |
| Foto diaria opaca | 1.262 ms |

La foto diaria pasó de estar al frente a 3.524 ms en la referencia a 1.255 ms en esta recarga.
La capa local anterior había quedado opaca a 2.861 ms: era otra etapa, no la foto diaria final.
No se presenta esta comparación como una reducción de 3,5 a 1,3 s desde el encendido de la TV.

La siguiente foto se precargó a 2.660 ms; su `decode()` transcurrió entre 2.663 y 2.816 ms,
quedando reservada para la rotación de cinco minutos. La primera imagen se mostró directamente
y las rotaciones posteriores conservan su fundido.

### Fallback y límites

Los tests validan el límite inicial remoto de 1.500 ms, el fallback local ante errores de carga y la
preservación de créditos y licencias. **No se verificó de forma concluyente el modo offline en
la TV**: `Network.emulateNetworkConditions` con `offline: true` no impidió transferencias en esta sesión. Otra observación sin
caché HTTP tuvo frente a 1.311 ms y opacidad a 1.316 ms; es una muestra, no una prueba offline.

La suite completa pasó **280/280**. El IPK verificado contiene **57 archivos**, incluidos **18 del
servicio**, y ocupa **1.690.546 bytes**. Los tests de la guardia externa pertenecen al repositorio,
no al contenido del IPK. SHA-256:
`7d9ef901916a6d258967be8e9d175e76ba3686926855c3d1396f4c0218a07175`.

## 0.7.4: fondo inmediato, foco y Luces

El dueño consideró aceptable la 0.7.3, pero pidió un fondo predeterminado mientras llega la foto,
un foco menos seco y un rediseño del panel Luces. La 0.7.4 está instalada.

`assets/wallpaper.svg`, una ilustración local de 5,5 KB ya incluida, ahora es el fondo CSS de la
pantalla y se precarga desde el HTML. Se ve antes de que el slideshow tenga una foto; esa foto
entra con un fundido de 1,2 s. Se conservan la foto diaria validada en caché, la galería local,
sus créditos y la rotación. El vidrio inicial se prepara después de presentar la foto, con rAF
y otra tarea, sin bloquear `onShow`. El canvas trabaja directamente a 160 px de ancho, con una
base y una capa de blur, sin los buffers intermedios grandes. Hay guardas y regresiones para
decode tardío, ocultar/volver, cambiar de galería y restaurar la base tras un fallo remoto.

### Muestra del fondo en la TV

Recarga por CDP sobre el paquete final, con la foto diaria en caché HTTP:

| Señal | Tiempo desde `performance.now()` |
| --- | ---: |
| Primer rAF que ve el SVG configurado por CSS | 308 ms |
| `first-paint` / `first-contentful-paint` | 554 ms |
| Asignación de la foto diaria | 607 ms |
| Carga / paso al frente | 1.040 / 1.043 ms |
| Primer rAF con opacidad de la foto mayor que cero | 1.240 ms |
| Foto con opacidad mayor que 0,95 | 2.235 ms |

La marca de 308 ms comprueba el estilo calculado; no acredita que el panel físico ya lo haya
mostrado. El primer pintado llegó antes de solicitar la foto diaria. El fundido tarda más en
alcanzar opacidad completa que el salto inmediato de 0.7.3 por decisión visual del dueño.
No se midió desde power-on ni se acredita aquí funcionamiento offline completo.

### Foco con movimiento al detenerse

Animar el vidrio durante cada flecha bajaba a unos 27 FPS en esta TV. Se descartaron esa
variante y las promociones de capas que no resolvieron el costo. El aro ahora responde sin
espera; la tarjeta se eleva 0,3 rem y escala a 1,055 en 140 ms sólo si el foco permanece 150 ms.
Al recorrer íconos rápidamente se cancela la animación pendiente. Movimiento reducido anula
duración y retraso. Izquierda/derecha en el dock de TV siguen el orden de los elementos
visibles sin pedir sus rectángulos; otras direcciones, vista previa y Personalizar conservan
la navegación geométrica.

En el paquete final, con flechas cada 120 ms durante 3,5 s: **208 intervalos**, media
**16,826 ms** (aprox. **59,4 FPS**), p95 **16,666 ms**, máximo **49,998 ms**, un intervalo
mayor de 25 ms y p95 del handler **20,6 ms**. Es una muestra de navegación rápida: no
demuestra 60 FPS al moverse despacio ni sustituye la evaluación con el control físico.

### Verificación y paquete

Luces se revisó en Brave a 1920×1080 y 1280×720 con un cliente simulado y hasta diez lámparas,
sin scroll global; flechas y Atrás conservaron el foco. En la TV real mostró las seis lámparas
guardadas y brillo común del 100 %, sin enviar cambios a las luces. Estado desconocido,
estado mixto y respuesta parcial tienen pruebas específicas. [Uso](lights.md#panel-074).

Pasaron **295/295 pruebas**, build, vista previa y verificación del IPK: **57 archivos**,
**18 del servicio**, **1.693.138 bytes**. SHA-256:
`bd440d5aa4d4a7c7e7a572430bdc7f64dde6d492ceee7cbdf3d7ee36288c165e`.
Se preservaron la configuración privada de captura y el rol del servicio. La lectura posterior
confirmó Home nativo, watcher sin polling de input, las preferencias publicitarias desactivadas
y las tres apps LG retiradas todavía ausentes. No se repitió el ciclo físico de encendido/Home.

## 0.7.5: Homebrew y auditoría del sistema

Se añadió el acceso a Homebrew Channel, con ID confirmado en el inventario de la TV, y se ajustó
el dock para ocho íconos sin scroll. Las elecciones y el orden guardados se conservan. El
acceso abrió Homebrew Channel en primer plano en hardware; la primera lectura durante la
apertura devolvió ID vacío y la posterior confirmó `org.webosbrew.hbchannel`. No se instaló
ninguna app desde la tienda ni se activó su herramienta de limpieza.

En Brave se revisó el dock a 1920×1080 y 1280×720; en la TV, a 1920×1080, los ocho accesos
quedaron dentro del viewport. La versión instalada registró **209 intervalos** al navegar
con flechas cada 120 ms durante 3,5 s: media **16,746 ms** (aprox. **59,7 FPS**), p95
**16,666 ms**, máximo **33,332 ms**, un intervalo mayor de 25 ms y p95 del handler **16,5 ms**.
Es una muestra por CDP; no prueba todos los ritmos de navegación ni tiempo desde power-on.

### CPU, memoria y almacenamiento

El nuevo [auditor de sólo lectura](../scripts/privacy-audit.cjs) se ejecutó en la TV por SSH
con verificación de identidad del host. La lectura posterior a instalar 0.7.5 devolvió:

- 121 apps: 104 de sistema y 17 removibles. Las tres LG retiradas seguían ausentes.
- Homebrew 0.7.3 y Mi pantalla 0.7.5 presentes; Home nativo dirigido a Mi pantalla.
- Preferencias publicitarias y Live Plus en `off`; Quick Start y `homeAutoLaunch` en `on`.
- Unos **328 MiB de memoria disponible** y **785 MiB de almacenamiento disponible** en esa
  muestra. Cambian según las apps abiertas; no son mejoras atribuidas a esta actualización.

Varias muestras breves mostraron `iconnectivity` usando aproximadamente el 25–26 % de toda la
máquina de cuatro núcleos. Una lectura por hilos encontró el consumo en un hilo llamado `pool`.
El binario referencia interfaces `ics`; no se identificó la causa de ese consumo, una secuencia
segura para reiniciarlo ni evidencia de envío de datos personales. **No se
detuvo ni se deshabilitó.** Es un candidato de diagnóstico, no una mejora ya aplicada ni una
prueba de espionaje. No se bloquean funciones de red o HDMI sólo por ese consumo.

La auditoría no cambia ajustes, servicios ni paquetes y no mide FPS. El intervalo de CPU es
aproximado; valida inventario, secuencia completa y coherencia de contadores antes de informar
resultados. Un fallo no se convierte en «todo limpio». [Privacidad](privacy-cleanup.md).

### Verificación del paquete

Pasaron **306/306 pruebas**, build, vista previa y verificación del IPK: **58 archivos**,
**18 del servicio**, **1.693.534 bytes**. SHA-256:
`362c72279a351595750d34de36c336e69ecd10c75bbfa1a99699176aa4b8610a`.
El auditor CLI queda en el repositorio, fuera del IPK: no añade un servicio residente a la TV.

## Línea base del 22 de octubre de 2026 (0.7.15)

Medida de solo lectura por SSH en la 49UN7310PSC (webOS 5.6.2). Los datos crudos quedan privados en
`artifacts/` (ignorado por Git); esto resume lo que se puede afirmar.

**Hardware y entorno.** SoC Realtek `rtd288o`, **ARMv7 de 32 bits**, 4 núcleos, kernel 4.4.84, glibc 2.28,
Node 8.12, **1,1 GB de RAM**. Eso descarta correr en la TV programas que pidan 64 bits o Node 18+.

**Corrección de un diagnóstico anterior.** Se dijo que la lentitud podía venir de swap sobre la flash y que había
«35 procesos esperando disco». No se sostiene:

- El **load average de ~36 es un artefacto de este kernel**: 32 de los 35 procesos en estado `D` son hilos del
  kernel del driver Realtek (`check_usb`, `PCRTRACK`, `rtkaudio_flow_t`, `hdmi_task`…) durmiendo en `msleep` o
  `down_timeout`. Es su forma normal de estar inactivos. No debe usarse para decidir nada.
- En reposo **no hay actividad de swap**: `pswpin` y `pswpout` en 0 por segundo durante 10 s, sin fallos mayores.
  Hay ~460 MB de swap ocupado, pero es memoria fría de apps aparcadas (p. ej. YouTube, 61 MB).
- Memoria disponible ~227–310 MB; CPU total ~20 %. Lo más alto en la muestra fue la propia sonda (3,2 %).

**Costo real de volver al inicio** (3 repeticiones cada uno, relanzando Mi pantalla desde HDMI 1, con
suscripción al primer plano en la TV y CDP para los tiempos de pintado):

| Caso | A primer plano | Primer pintado (FCP) | Carga | Swap-in |
| --- | --- | --- | --- | --- |
| **Aparcada** (Home con la app viva) | **110 ms** (110/117/109) | — (no recarga) | — | 20–56 páginas |
| **Arranque en frío** (app cerrada) | **~2,6 s** (2,7/2,6/2,1) | 0,76–0,97 s | 1,5–2,1 s | 72–1146 páginas |

Volver con Home es prácticamente instantáneo. Solo el arranque en frío (encendido, o cuando LG cierra la app por
memoria) tarda segundos. Dentro de la página, 20 scripts síncronos (~200 KB de JS) ocupan ~0,6 s hasta
`domInteractive` (607 ms) y el primer pintado llega a ~0,8 s; el resto hasta primer plano es de la TV (arranque
del renderer). El pedido del clima tarda ~1 s pero no bloquea el pintado.

**Qué quedaría por ganar, y por qué no se tocó.** Cargar tarde `lights-panel.js` (41 KB), `lights-client`,
`apps-manager` y `ambient-wallpaper` después del primer pintado recortaría como mucho ~100–200 ms del arranque en
frío (≈5–8 % del total), a costa de reestructurar el montaje del panel. No se hizo: la mejora es pequeña frente
al costo y el riesgo, y el caso frecuente (Home) ya es de 110 ms. Tampoco se detuvo ni deshabilitó ningún servicio
por esta medición.

## Rediseño A: foco con flechas (23 de octubre de 2026)

Mismo método que la 0.7.0, en la TV real y por CDP: flechas izquierda/derecha cada 120 ms durante 3,5 s
sobre la fila Apps, registrando los intervalos de `requestAnimationFrame`. Las variantes se inyectaron como CSS
en la página en vivo (sin instalar) y se retiraron al terminar. Valores típicos de 2–3 corridas por variante:

| Variante | Media entre cuadros | Percentil 95 | Intervalos > 25 ms |
| --- | ---: | ---: | ---: |
| TV en reposo, sin flechas | 16,67 ms | 16,67 ms | 0 de 150 |
| Rediseño instalado (escala animada tras 150 ms, halo difuso) | ~18,5 ms | 33,33 ms | 11–21 de ~210 |
| Sin halo difuso | ~18,2 ms | 33,33 ms | 11–19 |
| Espera de 60 ms antes de animar | ~27 ms | 50 ms | ~68 de ~145 |
| Sin espera, escala animada | ~38 ms | 50–67 ms | ~90 de ~100 |
| Escala animada con `will-change` o `translateZ` | sin cambio | — | — |
| Sin canvas de vidrio, sin sombra del panel o sin scroll de la fila | sin cambio relevante | — | — |
| **Escala instantánea y halo sin difuso (aplicado)** | **16,7–17,3 ms** | **16,67 ms** | **1–7 de ~230** |

Animar la escala del ícono es lo caro: los 150 ms de espera sólo lo ocultaban mientras se mantenía la flecha.
Bajar la espera lo empeoraba. Ahora, en TV, aro y escala cambian al instante y el halo es sólo el aro con el
borde de marca, sin sombra difusa. La vista previa de escritorio conserva la animación y el halo completo.
Con el paquete instalado (`com.frxn.mipantalla_0.7.15_all.ipk`, 99 archivos, SHA-256
`bbeedceaa490082ac0cb9f1d3cb56bcb81cda5d503591c9eacc8320244115e70`) y la app recién abierta, seis corridas del mismo
método dieron una media de 17,2–18,0 ms (mediana 17,3 ms). El percentil 95 fue de 16,67 ms en cinco corridas y de 33,33 ms en una.
Hubo 5–11 intervalos de más de 25 ms en ~225, con la TV en reposo a 16,67 ms. Se registró el recorrido del foco de una corrida:
va y vuelve dentro de la fila Apps. Falta la prueba con el control real.

## Estado de privacidad y protección del root el 22 de octubre de 2026

- **Life's Good Without Spying está activo** (hook `50-lifesgoodwithoutspying`, creado a la 01:54; no lo aplicó
  este proyecto). Según su propio registro: 430 dominios en `/etc/hosts`, 38 ejecutables de publicidad/ACR y 17 de
  voz reemplazados por stubs, ThinQ sin bloquear. `admanager`, `nudge`, `rdxd`, `uploadd`, `sportsalarm`,
  `acr2` y `livepick` ya no corren; `remotelogger` y `crashd` siguen. El hook propio de `rdxd` quedó redundante.
- **Actualizaciones del sistema:** Homebrew Channel tenía `blockUpdates: false`; los servidores de firmware
  (`snu.lge.com`, `su.lge.com`, `su-ssl.lge.com`, `su-dev.lge.com`) no estaban bloqueados, aunque `appUpdateMode`
  era `manual`. Se activó el bloqueo oficial de Homebrew Channel (archivo `webosbrew_block_updates`, aplica en
  cada arranque) y se agregaron esas mismas líneas a `/etc/hosts` para que valga sin reiniciar; respaldo previo
  en `/var/lib/mipantalla-maintenance/hosts-before-blockupdates-*.bak`. La Content Store sigue resolviendo
  (`us.lgappstv.com`). Revertir: `setConfiguration {"blockUpdates":false}` y quitar esas líneas. Efecto
  colateral esperado: «Actualización de software» de la TV no podrá consultar firmware.
