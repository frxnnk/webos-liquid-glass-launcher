# Próximos pasos: rendimiento, diseño e instalación

**Revisión: 2026-10-21.** Las mejoras de rendimiento y diseño siguen propuestas. El asistente
local incluye un adaptador experimental de root inicial, implementado pero no validado desde
una TV original. La TV está en 0.7.7; el asistente de PC tiene una UI nueva y el dock conserva
su diseño. No corresponde repetir el root ya existente.

## Primero, medir dónde se pierde tiempo

La última muestra documentada de 0.7.5 dio unos **59,7 FPS** navegando rápido. No es un benchmark
nuevo de esta ronda ni acredita navegación lenta, apertura de Luces o tiempo desde el encendido.
El objetivo es que las acciones cotidianas se sientan rápidas, no sumar efectos para mostrar FPS.

| Prioridad | Investigación o cambio propuesto | Qué hay que comprobar |
| --- | --- | --- |
| 1 | Perfilar `iconnectivity`, que tuvo una muestra previa cercana a 25–26 % de CPU. | Repetir en reposo y durante el uso; identificar trabajo y dependencias antes de atribuirle lentitud o detener algo. La causa sigue desconocida. |
| 2 | Crear el DOM de Luces recién al abrirlo y reutilizarlo después. | Comparar primer foco del inicio, primera apertura del panel y reapertura; conservar estados, Atrás y mensajes. |
| 3 | Comparar dos materiales de tarjeta, manteniendo composición e íconos. | Probar A/B con flechas lentas y rápidas: vidrio discreto frente al actual, sin nuevos filtros ni sombras animadas. |
| 4 | Revisar imágenes retenidas cuando Mi pantalla queda oculta. | Medir RAM frente a la latencia al volver con Home; liberar una foto puede exigir decodificarla de nuevo. |

Antes de tocar cada punto, tomar una base con la misma versión, escenario, fotos y estado de red.
Registrar primer pintado, primer foco utilizable, tiempo hasta la foto y sus percentiles en varias
repeticiones, además de RAM y CPU en reposo. Separar recarga, vuelta con Home y arranque físico.
Una sola muestra no alcanza para prometer una mejora; borrar apps instaladas tampoco demuestra
menos CPU. [Método y resultados anteriores](performance.md).

## Una dirección visual más tranquila

Estas referencias sirven para tomar decisiones, no para copiar su interfaz completa:

| Referencia revisada | Qué tomaría para Mi pantalla |
| --- | --- |
| [Apple TV 4K](https://www.apple.com/apple-tv-4k/) | Composición de TV, fotografía y foco evidente a distancia; una jerarquía sencilla alrededor del dock. |
| [Apps de Bang & Olufsen](https://www.bang-olufsen.com/en/int/story/apps) | Controles claros, calma visual y acentos marfil/ámbar para Luces, sin llenar todo de brillos. |
| [Roon](https://roon.app/en/music) | Jerarquía editorial y carátulas para una futura vista musical de Transitions. |

El dueño eligió **Apple TV como dirección principal y rendimiento como prioridad**, con la calma
de B&O: menos brillo en los bordes,
radios, tipografía y espaciado consistentes, vidrio más discreto y foco legible. Una vista musical
sería opcional; no hace falta descargar portadas para abrir un episodio. No hay un rediseño nuevo
implementado ni medido a partir de estas referencias.

## ¿Conviene reescribirlo con Flutter?

La [guía oficial de LG para Flutter](https://webostv.developer.lge.com/develop/guides/flutter-for-webos)
describe soporte nativo a partir de **webOS 26 Re:New**, con herramientas
en un host Ubuntu. No documenta soporte nativo para el **webOS 5.6** de esta TV.

[Flutter Web](https://docs.flutter.dev/reference/supported-platforms) publica soporte para las dos
últimas versiones de Chrome; Chrome 95 y anteriores quedan fuera del soporte. Chromium 68 de
esta LG queda fuera de esa matriz. Compilar para web no elimina la antigüedad de su navegador.

**Decisión propuesta:** conservar HTML/CSS/JS ES5 y medir cambios puntuales. No hay evidencia de
que una reescritura mejore aquí CPU, RAM o arranque. Un port nativo con embedder propio y root
sería otro experimento, con compatibilidad, gráficos, entrada e instalación por resolver; no un
atajo respaldado por esa guía. Esta conclusión es una inferencia de compatibilidad, no un A/B
ejecutado con Flutter en la TV.

## Piloto local y root inicial experimental

`npm run setup` inicia un **programa local temporal** para manejar desde Brave. Requiere Node
18+ y OpenSSH. Instalar o limpiar requiere root SSH y huella verificada; preparar root tiene
requisitos y comprobaciones propios. El único perfil admitido
es 49UN7310PSC / 04.64.00 / 5.6.2-21 / K6LP_ATSC_BR. [Guía del piloto](local-installer.md).

La API local tiene acciones cerradas, sesión autenticada, validación de origen y tiempos
máximos. Las credenciales quedan en la computadora y no aparecen en URLs, logs compartibles o
servidores públicos. Al terminar se cierra el compañero local; no exige un servidor permanente.

| Etapa | Alcance | Estado |
| --- | --- | --- |
| 1 | Conectar y planificar; instalar el IPK público si falta la app. | Implementado. Omite 0.7.7 existente; actualizar otra versión queda bloqueado hasta preservar configuración. |
| 2 | Home, perfil de privacidad, tres bajas LG opcionales, respaldo y restauración acotada. | Apply de privacidad idempotente y restore tras recargar probados en TV. Home, instalación y bajas no se aplicaron con el piloto. |
| 3 | Root desde cero para el perfil exacto. | Adaptador experimental implementado; pendiente validar la cadena desde stock y la confianza SSH humana. Omite root activo. |

El motor tiene **plan / apply / restore**, con journal privado y lectura posterior; son acciones
de la API, no comandos CLI. El plan vence en cinco minutos. Ante timeout se consulta el estado
del destino original sin repetir la operación. Restaurar no reinstala apps retiradas ni elimina
el paquete nuevo: esos pasos son manuales. Instalar o limpiar requiere root y emparejamiento
previos; root inicial usa un plan separado y sólo ejecuta al aplicarlo explícitamente.

La suite pasó 401 pruebas y la revisión cerró sin P1/P2. `status` y `plan` funcionaron en Brave
contra la TV; el apply de privacidad creó respaldos reales y conservó el snapshot previo.
Tras recargar, `status` recuperó el respaldo y restore completó; otra lectura SSH confirmó el
snapshot completo igual al inicial. Es una prueba sobre ajustes ya apagados, no instalación
desde cero ni arranque físico con hooks nuevos.

### Qué aporta SlopBro y qué falta

Se revisó [SlopBro, revisión `21023d5`](https://github.com/throwaway96/slopbro/tree/21023d56ca424607bb03d2939609cc658c655fc7).
Su flujo utiliza una computadora con Python/HTTP y SSAP, y obtiene root mediante un payload
ejecutado en la TV. No es una página estática universal que pueda rootear cualquier LG.

El adaptador ya fija perfil, fuentes y hashes, conserva el script firmado y el token regular
de Developer Mode y omite root activo. Falta validar la cadena desde stock, confianza SSH
inicial, interrupciones y recuperación física. La investigación upstream produjo un error de
firma de Developer Mode y necesitó recuperación manual; ese recorrido no se repite.
[Evaluación completa](browser-installer.md).

## Funciones que sí aportarían en el uso diario

1. **Escenas Cine, Música y Noche:** guardar y aplicar los ajustes elegidos de WiZ con OK,
   respuesta por lámpara y posibilidad de restaurar el estado anterior.
2. **Apps detectadas y recientes locales:** favoritos sin perder orden ni ocultos; distinguir
   instalada, ausente y sin confirmar. Reabrir una app no garantiza retomar un video exacto.
3. **Modo local/offline:** conservar fotos incluidas y WiZ, pausando pedidos de clima y fotos
   diarias. No promete aislar del exterior a LG, YouTube ni otras apps.
4. **Privacidad con estado y reversión:** mostrar valores leídos, fecha y respaldo; restaurar
   únicamente ajustes propios. Desactivar logs o anuncios no acredita cero telemetría.

Estas funciones están propuestas. Su costo, requisitos y aceptación se amplían en
[visión del producto](product-vision.md). El orden recomendado es medir y simplificar primero,
cerrar recuperación e instalador después y sumar funciones sin agregar trabajo al foco del dock.
