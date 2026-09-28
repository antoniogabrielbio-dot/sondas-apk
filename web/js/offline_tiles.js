/**
 * Gerenciador de Mapa Offline (Cache de Tiles)
 * Permite pré-carregar os blocos de mapa da região de Santarém/UFOPA para uso 100% offline em campo.
 */

const OfflineManager = {
  // Bounding box padrão: Região de Santarém, Belterra, Mojuí dos Campos e entorno da UFOPA
  DEFAULT_BOUNDS: {
    minLat: -2.75,
    maxLat: -2.15,
    minLon: -55.30,
    maxLon: -54.40
  },

  TEMPLATES: {
    satelite: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    relevo: 'https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
    ruas: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  },
  CACHE_NAME: 'sondas-v2-tiles',

  // Converte Lat/Lon para coordenadas de bloco (Tile X, Y)
  lon2tile(lon, zoom) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
  },

  lat2tile(lat, zoom) {
    return Math.floor(
      (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
    );
  },

  // Estima quantos blocos de mapa serão baixados
  calcularTotalBlocos(minZoom = 10, maxZoom = 13, bounds = null) {
    const b = bounds || this.DEFAULT_BOUNDS;
    let total = 0;

    for (let z = minZoom; z <= maxZoom; z++) {
      const minX = this.lon2tile(b.minLon, z);
      const maxX = this.lon2tile(b.maxLon, z);
      const minY = this.lat2tile(b.maxLat, z);
      const maxY = this.lat2tile(b.minLat, z);

      total += (Math.abs(maxX - minX) + 1) * (Math.abs(maxY - minY) + 1);
    }
    return total;
  },

  // Baixa os blocos e armazena no TileDB (IndexedDB) para uso nativo offline
  async baixarAreaOffline(minZoom = 10, maxZoom = 13, bounds = null, onProgress = null, tipo = 'ruas') {
    const b = bounds || this.DEFAULT_BOUNDS;
    const total = this.calcularTotalBlocos(minZoom, maxZoom, b);
    const template = this.TEMPLATES[tipo] || this.TEMPLATES.ruas;

    let baixados = 0;
    let erros = 0;

    for (let z = minZoom; z <= maxZoom; z++) {
      const minX = this.lon2tile(b.minLon, z);
      const maxX = this.lon2tile(b.maxLon, z);
      const minY = this.lat2tile(b.maxLat, z);
      const maxY = this.lat2tile(b.minLat, z);

      const startX = Math.min(minX, maxX);
      const endX = Math.max(minX, maxX);
      const startY = Math.min(minY, maxY);
      const endY = Math.max(minY, maxY);

      for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
          const key = `${tipo}_${z}_${x}_${y}`;
          const url = template
            .replace('{z}', z)
            .replace('{x}', x)
            .replace('{y}', y);

          try {
            const jaExiste = window.TileDB ? await TileDB.obterTile(key) : null;
            if (!jaExiste) {
              const dataUrl = await this.carregarTileComoDataUrl(url);
              if (dataUrl && window.TileDB) {
                await TileDB.salvarTile(key, dataUrl);
              } else {
                erros++;
              }
            }
          } catch (e) {
            erros++;
          }

          baixados++;
          if (onProgress) {
            onProgress(baixados, total, erros);
          }

          // Delay suave para não sobrecarregar
          if (baixados % 10 === 0) {
            await new Promise((r) => setTimeout(r, 20));
          }
        }
      }
    }

    return { baixados, total, erros };
  },

  carregarTileComoDataUrl(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 256, 256);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  },

  // Conta quantos blocos já estão armazenados localmente
  async contarBlocosSalvos() {
    if (window.TileDB) {
      return await TileDB.contarBlocosSalvos();
    }
    return 0;
  },

  // Limpa o cache de blocos
  async limparCacheTiles() {
    if (window.TileDB && TileDB.db) {
      const tx = TileDB.db.transaction('tiles', 'readwrite');
      tx.objectStore('tiles').clear();
    }
  }
  }
};

window.OfflineManager = OfflineManager;
