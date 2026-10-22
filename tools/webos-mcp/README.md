# Servidor MCP para la TV

Deja que un agente en tu PC (Claude Code, opencode u otro cliente MCP) mire y maneje una LG webOS con root
que corre Mi pantalla. **El agente corre en la PC, no en la TV**: la TV es ARMv7 de 32 bits con ~300 MB libres y
Node 8, y Claude Code pide x64 o ARM64. Este servidor habla con la TV por SSH y solo expone herramientas fijas;
no hay ninguna que ejecute comandos arbitrarios.

| Herramienta | Qué hace |
| --- | --- |
| `tv_status` | Firmware, tiempo encendida, memoria, app en primer plano, versión de Mi pantalla, estado de Auto |
| `list_apps` | Apps visibles de la TV (id y título) |
| `launch_app` | Abre una app por id (solo si la TV la tiene instalada) |
| `go_home` | Abre Mi pantalla |
| `lights_get` / `lights_set` | Estado y cambio (encendido, brillo, color o blanco) de las lámparas elegidas |
| `auto_status` / `auto_set` | Estado y activación del modo Auto |
| `screenshot` | Captura de Mi pantalla por el inspector web (Node 22+, con la app abierta) |

## Requisitos y configuración

Node 18+ (22+ para `screenshot`), OpenSSH, root en la TV con tu clave pública autorizada y la huella de la TV ya
aceptada en `known_hosts` (el servidor usa `StrictHostKeyChecking=yes`). Variables:

- `WEBOS_TV_HOST`: dirección de la TV (obligatoria)
- `WEBOS_TV_SSH_KEY`: ruta de la clave privada del usuario root de la TV (obligatoria)
- `WEBOS_TV_SSH_PORT`: por defecto 22
- `WEBOS_TV_CDP_PORT`: por defecto 9998 (inspector web)

Claude Code:

```sh
claude mcp add webos --env WEBOS_TV_HOST=192.168.1.50 --env WEBOS_TV_SSH_KEY=$HOME/.ssh/lg_key -- node /ruta/al/repo/tools/webos-mcp/server.cjs
```

Cualquier cliente que lea un `mcpServers` en JSON:

```json
{"mcpServers": {"webos": {"command": "node", "args": ["/ruta/al/repo/tools/webos-mcp/server.cjs"],
  "env": {"WEBOS_TV_HOST": "192.168.1.50", "WEBOS_TV_SSH_KEY": "/home/yo/.ssh/lg_key"}}}}
```

## Límites y seguridad

- Cualquiera que pueda usar el cliente MCP puede abrir apps y cambiar luces de tu TV: tratálo como acceso a la casa.
- `lights_set` cambia lámparas reales; el servicio de Mi pantalla restaura primero si Pantalla completa o Auto estaban activos.
- La clave SSH y la dirección de la TV viven solo en variables de entorno; nada de esto se guarda en el repositorio.
- Probado con un SSH simulado (`tests/webos-mcp.test.cjs`). Con la TV real se verificó el mismo conjunto de llamadas
  `luna-send` que ya usan el instalador y Auto; el servidor completo contra un cliente MCP real no se corrió todavía.
