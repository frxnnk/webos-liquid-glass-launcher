# Roadmap

Estado al **2026-10-21**. El dueño probó **0.7.4** y confirmó que anda bastante bien.
La **0.7.8 experimental está instalada**, con parche nativo single owner y parada completa.
La carrera original se reprodujo localmente; se verificaron ABI y preparación en la TV.
Manual por API detuvo PicCap y restauró 6/6 estados; Home con captura apagada llegó a Mi pantalla.
Video, Home con captura activa y estabilidad siguen pendientes de confirmación física.
La suite local pasó 590/590 y el harness nativo diez escenarios, también con ASan/UBSan.
Ver [reparación y reproducción](capture-repair.md). En 0.7.6, desde PC, el dueño
confirmó colores de YouTube en seis WiZ y restauración 6/6.
Este documento separa funciones existentes, pruebas concretas y propuestas.

## Entregado

| Etapa | Resultado | Evidencia y límites |
| --- | --- | --- |
| 0.2–0.3 | Diseño Liquid Glass, íconos sin nombres, cuatro fotos, clima y Personalizar. | Aceptación visual en la TV; frontend web, sin reemplazar firmware. |
| 0.4–0.4.1 | Fotos diarias, Transitions y marca Bedrock. | Código/preview/IPK probados. Enlace YouTube por CLI confirmado tras elegir perfil; no atribuir esa prueba al dock. |
| 0.5–0.5.1 | WiZ manual y Acompañar fondo. | El dueño confirmó brillo en seis lámparas y luego color del fondo. |
| 0.6 | PicCap/HyperHDR, Pantalla completa y primera integración de Home. | Root/HBC persistente; activación y restauración físicas de luces. Arranque frío observado. HDMI/DRM y persistencia de pantalla pendientes. |
| 0.7–0.7.1 | Navegación liviana y wake por estado de potencia. | El encendido de 0.7 falló; 0.7.1 corrigió el caso de apagar 20 s con el control. |
| 0.7.2 | Home nativo y watcher sin polling de input. | El dueño confirmó YouTube → Home y apagar 20 s → encender directos a Mi pantalla, sin LG primero en esos casos. |
| 0.7.3 | Primera foto directamente desde la galería diaria validada en caché. | Menor demora en recarga CDP; no mide desde encendido ni acredita offline. |
| 0.7.4 | Fondo SVG inmediato, foto con fundido, foco suave al detenerse y rework Luces. | 295 pruebas; instalado. Muestra de navegación rápida ~59,4 FPS y primer pintado a 554 ms por CDP; el dueño después confirmó buen funcionamiento general. |

El Home nativo usa `general.defaultApps.home` y conserva los demás defaults. El watcher mantiene
boot y power/wake. Una guardia externa intenta restaurar el Home anterior si desaparece la app;
sus tests y ejecución manual con app presente no prueban un arranque físico con app ausente.
[Home y reversión](home-takeover.md) · [rendimiento y metodología](performance.md).

El diseño original y parte de la documentación se hicieron con Opus. El rework 0.7.4 se terminó
con Codex al fallar la autenticación del delegador; no atribuir a Opus ese cambio.

## Ronda 0.7.5

- Acceso a `org.webosbrew.hbchannel`, ocultable/reordenable como los demás. Abrir la tienda es
  una acción explícita: el acceso no instala apps ni activa root.
- Actualizar el tutorial al flujo actual: Developer Mode, compilación, verificación, instalación,
  configuración privada, Home manual con respaldo/guardia y reversión antes de desinstalar.
- Explicar los límites de limpiar apps, desactivar promociones y demostrar tráfico saliente.
- Implementar el asistente local para Brave y registrar por separado las operaciones probadas
  y la cadena experimental de root; no presentar el flujo desde una TV original como validado.
- Publicar `privacy-audit.cjs` como diagnóstico CLI de solo lectura con root ya disponible;
  no instala ni modifica ajustes; es independiente del asistente local.
- Mantenimiento posterior, con la 0.7.5 instalada y sin nuevo IPK: retiradas Apple Music,
  Apple TV, DGO y Star+, todas verificadas como no sistema y removibles. Inventario final
  **117 apps, 104 de sistema y 13 removibles**; los 13 paquetes protegidos siguen presentes.
- Registrar comprobaciones finales de la versión exacta en el README.

[Automatización evaluada](browser-installer.md) · [visión del producto](product-vision.md).

## Piloto del asistente local: programa de PC

`npm run setup` ya inicia interfaz y motor local con `status`, `plan`, `apply` y `restore` como
acciones internas, no flags CLI. El módulo de instalación y limpieza usa Node 18+, OpenSSH,
root previo y huella verificada; admite
únicamente 49UN7310PSC / 04.64.00 / 5.6.2-21 / K6LP_ATSC_BR. Instala el IPK público si la app
falta, omite 0.7.7 existente y bloquea actualizar otra versión hasta resolver preservación.
Home, siete preferencias, dos permisos RDX y tres bajas LG opcionales tienen respaldo y lectura
posterior. Hay journal local/TV y restauración acotada; reinstalar apps o desinstalar el paquete
nuevo siguen siendo pasos manuales. En la validación inicial del piloto pasaron 401 pruebas y la
revisión cerró sin P1/P2; status,
plan y apply idempotente de privacidad se probaron en Brave contra la TV, con respaldo real.
Después de recargar se recuperó ese respaldo y se restauró: otra lectura SSH confirmó journal
`restored` y snapshot completo igual al inicial. Home, instalación y bajas no se aplicaron con
el piloto; no heredan las pruebas físicas del procedimiento manual. Faltan instalación real
del IPK público, la cadena completa desde una TV original y arranque físico con hooks nuevos.
[Guía y estado de verificación](local-installer.md).

La TV está en 0.7.7. El asistente de PC tiene una UI inspirada en Apple TV; el dock de la TV
conserva su diseño y rendimiento como prioridad. Persistencia de captura tras reinicio, HDMI
y DRM siguen pendientes.

El adaptador de root **ya está implementado como experimental**, sólo para el perfil anterior
con build `jhericurl-jimna`. Consulta root y Developer Mode, fija fuentes y hashes, prepara un
bootstrap propio, respalda, provisiona HBC y verifica accesos posteriores. Conserva el script
firmado y el token regular de Developer Mode, evitando el tramo upstream que había exigido
recuperación manual. Una reserva exclusiva por IP impide repetir cadenas paralelas o inciertas.

El diagnóstico real y el plan en la TV ya rooteada **omiten el bootstrap**. No se ejecutó esta
cadena desde una TV original ni se repitió el root de la TV actual. Siguen pendientes la primera
confianza de huellas SSH desde la UI y la prueba física del flujo nuevo; no hay downgrade,
soporte universal ni unroot verificado. [Alcance y recuperación del adaptador](root-automation.md).

## Prioridad 1: recuperación y mantenimiento verificables

1. Probar restore de Home y la guardia con la app ausente durante un arranque real, con acceso
   SSH y físico de recuperación. No usar el resultado de `app-present` como prueba de ese caso.
2. Cubrir actualización de IPK con configuración privada y roles ya instalados, fallos de red
   y rollback parcial. El piloto omite 0.7.7 presente y bloquea actualizar otra versión; la
   preservación completa de una actualización sigue siendo un procedimiento manual.
3. Repetir Home desde varias apps, foco posterior, Home repetido/mantenido y otros ciclos de
   standby/Quick Start. La confirmación de YouTube y apagado de 20 s no acredita todos esos casos.
4. Registrar versiones/hashes de HBC, PicCap e HyperHDR y una matriz limitada de compatibilidad.
   Un modelo que no coincida debe recibir un estado explícito de soporte desconocido.

## Prioridad 2: privacidad con evidencia

- Inventariar primero; distinguir apps removibles, servicios, preferencias y tráfico.
- Mantener un perfil mínimo reversible: ajustes conocidos con backup y readback, sin borrar
  dependencias de imagen, audio, red, DRM, app manager, ajustes o recuperación.
- Si se evalúa una herramienta de limpieza de Homebrew, revisar su versión y cada acción antes
  de aplicarla. Su presencia en una tienda no prueba compatibilidad ni privacidad.
- Para afirmar bloqueo de destinos, registrar qué se observó y cómo se comprobó. Ajustes de
  promociones apagados no demuestran «cero datos compartidos»; DNS no identifica por sí solo
  contenido cifrado ni garantiza que una app no use otro canal.

El inventario pasó de 124 a 121 al retirar tres removibles de LG, y después a **117** al quitar
Apple Music, Apple TV, DGO y Star+. El dueño eligió conservar Prime Video, Paramount+, HBO Max,
Movistar TV, Stremio y Twitch; esas seis y las siete apps principales/herramientas protegidas
quedaron verificadas presentes. Las 104 apps de sistema se conservaron; no se borraron ni
deshabilitaron servicios ni se modificó el firmware. Esta ronda no cambió la versión 0.7.5 ni
generó otro IPK. [Procedimiento, respaldo privado y límites de recuperación](cleaning.md).

RDX quedó con `analyticsLog: false` y `crashLog: false`, comprobados después del cambio y con
respaldo previo. `rdxd` sigue activo, sin reinicio. El hook de persistencia se probó manualmente
(`already-applied`); falta comprobarlo en un arranque físico. No acredita cero telemetría.
[Alcance, script y reversión](diagnostic-privacy.md).

## Prioridad 3: rendimiento percibido y medido

- Conservar el fondo local desde primer pintado y diferir red/decode/vidrio sin bloquear flechas.
- Medir navegación lenta y rápida, apertura de Luces y vuelta desde apps con la misma metodología.
- Separar aceptación con control físico, muestras rAF por CDP y tiempo desde power-on.
- Evitar nuevos efectos de pantalla completa, polling y servicios en reposo sin una mejora
  demostrada. Borrar apps instaladas no garantiza menor CPU.
- Mantener modos manuales y un error claro al faltar red, lámparas o fuente de captura.

La 0.7.4 cancela la elevación pendiente al recorrer íconos rápido; el aro responde al instante y
el movimiento llega al detenerse. Animar vidrio durante cada flecha se descartó por su costo.
[Detalle](performance.md#074-fondo-inmediato-foco-y-luces).

## Prioridad 4: instalación reproducible

Cerrar el piloto local con ensayos de instalación ausente, restore, timeout y recuperación
en hardware. El programa y la UI ya existen; no equivalen a un instalador terminado para una
TV original. El paquete público 0.7.7 está publicado, sin configuración del hogar y con hash
fijado. Quedan pendientes las actualizaciones entre versiones y acreditar en una TV original
el adaptador de root experimental ya implementado, incluida la confianza inicial de huellas SSH.
Conservar acciones cerradas de loopback; no agregar una shell pública. Browser-only no reemplaza
SSH ni proporciona root universal. [Comparación y fuentes](browser-installer.md) ·
[cadena de root por modelo](root-automation.md).

## Funciones para evaluar

Las propuestas de experiencia, su utilidad frente al stock y sus costos están en
[visión del producto](product-vision.md). Una idea entra a implementación cuando hay un caso
concreto, navegación con control y un presupuesto de red/CPU. No añadir servicios permanentes
solo para completar una lista de features.

Quick Access de LG es una alternativa sin root para abrir una app con una tecla numérica.
**No se probó con nuestra app de desarrollo en esta TV.**
[Guía de LG](https://www.lg.com/es/soporte/guias-y-soluciones/television/webos-3-5-funcion-quick-access/).

## Fuera de alcance actual

- Reemplazar firmware o los menús internos de las apps.
- Afirmar cero telemetría sin un ensayo de red adecuado.
- Purgar componentes de sistema sin dependencias identificadas y recuperación comprobada.
- Prometer HDMI o contenido protegido en Pantalla completa sin pruebas específicas.
- Redistribuir IPK de terceros o configuraciones, certificados, llaves y tokens del hogar.
- Root automático para cualquier TV o un instalador browser-only anunciado como terminado.
