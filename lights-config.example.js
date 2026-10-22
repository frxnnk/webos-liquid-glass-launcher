// Ejemplo de configuración de luces. Copiá este archivo a lights-config.js (no se publica) para activar el botón Luces.
// Sin lights-config.js el botón solo aparece en la TV; fuera de ella (vista previa en el navegador) queda oculto.
// El panel controla lámparas WiZ de tu red local: si no tenés, poné enabled: false y el botón no se muestra nunca.
window.LAUNCHER_LIGHTS = {
  // enabled: false,          // oculta el botón Luces aunque estés en la TV
  // roomName: 'Living',      // título del panel; por defecto «Luces»
  // Lámparas elegidas al instalar (opcional): los ids salen de «Buscar lámparas» en el panel.
  // Solo se usan si todavía no hay una selección guardada.
  // selectedIds: ['wiz-aabbcc001122']
};
