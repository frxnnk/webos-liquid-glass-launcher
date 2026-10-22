# Elegir las apps y su orden

Desde la **0.7.9**, Personalizar permite sumar las apps instaladas que la TV ofrece para abrir,
además de los accesos iniciales de Mi pantalla.

## Modo Solo fondo (0.7.10)

**Personalizar** está arriba a la izquierda, en el lugar de la marca. **Solo fondo**, junto a
Luces, oculta el dock, reloj, clima y textos para dejar la imagen a pantalla completa.
La galería conserva su rotación y las fotos diarias.

Para volver, pulsá **OK**, **Atrás** o una flecha; con puntero, hacé un clic. La primera
pulsación sólo recupera la interfaz y el foco, sin abrir una app. Volumen y reproducción
siguen disponibles. Al salir de Mi pantalla, el modo se desactiva; al volver aparece el inicio.
No se guarda como modo de arranque. Los créditos de las fotos se consultan en Personalizar → Fuentes.

## Agregar u ocultar

1. Abrí **Personalizar**. Se consulta el catálogo de la TV al abrir el panel; el encendido del
   launcher no espera esa búsqueda.
2. Buscá la app en la lista y pulsá **Agregar**. Aparece en el inicio y el cambio se guarda en
   ese momento.
3. Para sacarla de la fila, pulsá su control **En inicio**: queda oculta y la podés volver a agregar.
4. Si instalaste otra app, usá **Actualizar apps** o cerrá y volvé a abrir Personalizar.

Ocultar un acceso **no desinstala la app**. Agregarlo tampoco instala nada: abre la aplicación
que ya está en la TV. Por ejemplo, Nuvio tiene un acceso inicial; en esta unidad se instaló el 22 de octubre de 2026
y aparece en el inventario, pero un acceso por sí solo no reemplaza su instalación.

## Cambiar el orden con el control

Usá las flechas del control para elegir una fila y sus botones; **OK** aplica la acción.
Los botones **↑** y **↓** de cada app visible la mueven una posición antes o después entre las
apps del inicio. El orden se guarda con cada cambio. Primero agregá una app oculta para moverla.

Las apps y las entradas tienen secciones separadas: mover una app no cambia el lugar de HDMI 1.
Al volver al inicio, recorré los íconos con izquierda y derecha. Si no entran todos, la fila se
desplaza horizontalmente para mostrar completo el ícono seleccionado.

## Guardado, errores y restablecer

Se conserva tu selección anterior, incluido el orden del formato `mi-pantalla-layout-v1`.
Los accesos que agregues también se guardan con los datos necesarios para mostrarlos al abrir,
antes de recibir otro inventario. Si la consulta falla o estás sin conexión, se mantiene esa
selección y podés reintentar; un error no se interpreta como una lista vacía.

**Restablecer selección** devuelve los accesos iniciales y su orden. Las otras apps que ya
aparecieron en el catálogo quedan ocultas, pero siguen disponibles para agregar desde la lista.

## Qué aparece en el catálogo

En la LG de referencia, la consulta devolvió 119 registros del sistema y 22 apps visibles para
abrir. Mi pantalla filtra procesos internos y apps ocultas por el sistema, y evita repetir los
accesos que ya conoce. La cantidad cambia según lo instalado; esos números no son un límite.

La vista previa del navegador muestra los accesos iniciales. Para consultar el catálogo real,
abrí Mi pantalla en la TV. Esta pantalla administra accesos: no modifica los servicios internos
de webOS ni instala o desinstala aplicaciones.

## Apps de sistema de LG

Personalizar lista las apps que la TV declara visibles. En la 49UN7310PSC son 24 de 121: LG marca como
`visible:false` las otras 97, y casi todas son internas (superposiciones de publicidad, fábrica, ejemplos,
ajustes de entradas). Una lista fija por id ofrece las que sí sirven desde el inicio, siempre «fuera del
inicio» hasta que las agregues:

| App | Id | Nota |
| --- | --- | --- |
| Configuración | `com.palm.app.settings` | |
| TV en vivo, Guía de TV | `com.webos.app.livetv`, `com.webos.app.livemenu` | |
| Grabaciones, Notificaciones | `com.webos.app.recordings`, `com.webos.app.notificationcenter` | |
| Compartir pantalla, AirPlay | `com.webos.app.miracast`, `airplay` | |
| Ayuda rápida, Guía del usuario | `com.webos.app.self-diagnosis`, `com.webos.app.tvuserguide` | |
| Home de LG | `com.webos.app.home` | Atajo de recuperación al Home original |
| HDMI 2, HDMI 3 | `com.webos.app.hdmi2`, `com.webos.app.hdmi3` | Van a la sección de entradas |

No están a propósito: **Software Update** (un firmware nuevo puede quitar el root), Installation y las
apps de fábrica. HDMI 4 tampoco: muchos modelos tienen tres puertos y HDMI 1 ya es un acceso propio.
Un acceso a una entrada sin señal solo muestra pantalla negra. Sin TV, `?demo=lights&apps=tv` en la vista
previa local simula este catálogo (pulsá «Actualizar apps»).
