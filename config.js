// IDs confirmados por inventario SSAP en la LG de prueba; pueden variar en otros modelos o regiones.
// logo: ícono local completo (SVG 120×120 con su fondo). color: anillo y halo de foco de la marca.
// tvIcon: usa el ícono que declara la TV (lo copia el servicio de luces); el logo local queda de respaldo.
window.LAUNCHER_CONFIG = [
  { key: 'youtube', title: 'YouTube', appId: 'youtube.leanback.v4', logo: 'assets/logos/youtube.svg', color: '#ff0033', tagline: 'Videos y música', kind: 'app' },
  { key: 'spotify', title: 'Spotify', appId: 'spotify-beehive', logo: 'assets/logos/spotify.svg', color: '#1ed760', tagline: 'Música y podcasts', kind: 'app' },
  { key: 'netflix', title: 'Netflix', appId: 'netflix', logo: 'assets/logos/netflix.svg', color: '#e50914', tagline: 'Series y películas', kind: 'app' },
  { key: 'disney', title: 'Disney+', appId: 'com.disney.disneyplus-prod', logo: 'assets/logos/disney.svg', color: '#3d7bff', tagline: 'Disney, Pixar, Marvel y Star Wars', kind: 'app', tvIcon: true },
  { key: 'twitch', title: 'Twitch', appId: 'tv.twitch.tv.starshot.lg', logo: 'assets/logos/twitch.svg', color: '#9146ff', tagline: 'Streams en vivo', kind: 'app' },
  { key: 'hbomax', title: 'HBO Max', appId: 'com.hbo.hbomax', logo: 'assets/logos/hbomax.svg', color: '#5b6cff', tagline: 'Series y películas', kind: 'app' },
  { key: 'flow', title: 'Flow', appId: 'flow', logo: 'assets/logos/flow.svg', color: '#1fd1e0', tagline: 'TV en vivo y on demand', kind: 'app', tvIcon: true },
  { key: 'hdmi1', title: 'HDMI 1', appId: 'com.webos.app.hdmi1', logo: 'assets/logos/hdmi-1.svg', color: '#e8ecf4', tagline: 'Entrada externa', kind: 'input' },
  { key: 'hdmi2', title: 'HDMI 2', appId: 'com.webos.app.hdmi2', logo: 'assets/logos/hdmi-2.svg', color: '#e8ecf4', tagline: 'Entrada externa', kind: 'input' }
];
