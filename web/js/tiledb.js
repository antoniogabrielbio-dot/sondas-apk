/**
 * Sondas 2.0 - TileDB (Armazenamento Nativo IndexedDB com Fallback Canvas)
 * Garante que o mapa NUNCA fique preto quando estiver offline no celular.
 * Salva tiles automaticamente e escala blocos pais quando um zoom não existir.
 */

const TileDB = {
  DB_NAME: 'SondasMapTilesDB',
  DB_VERSION: 1,
  STORE_NAME: 'tiles',
  db: null,

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onerror = (e) => {
        console.warn('[TileDB] Erro ao abrir IndexedDB:', e);
        reject(e);
      };
    });
  },

  async salvarTile(key, dataUrl) {
    try {
      const db = await this.init();
      return new Promise((resolve) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        store.put(dataUrl, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
    } catch (e) {
      return false;
    }
  },

  async obterTile(key) {
    try {
      const db = await this.init();
      return new Promise((resolve) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) {
      return null;
    }
  },

  salvarTileDaImg(key, img) {
    try {
      if (!img.complete || img.naturalWidth === 0) return;
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 256, 256);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      this.salvarTile(key, dataUrl);
    } catch (e) {
      // Ignora erro de CORS se o servidor não permitir canvas toDataURL
    }
  },

  /**
   * Se o bloco exato não estiver salvo no aparelho, busca o bloco-pai
   * em zooms menores (até 4 níveis) e corta/estica no Canvas.
   * Isso IMPEDE que a tela fique preta!
   */
  async buscarBlocoPai(tipo, coords) {
    for (let delta = 1; delta <= 5; delta++) {
      const pz = coords.z - delta;
      if (pz < 5) break;

      const fator = Math.pow(2, delta);
      const px = Math.floor(coords.x / fator);
      const py = Math.floor(coords.y / fator);
      const parentKey = `${tipo}_${pz}_${px}_${py}`;

      const parentData = await this.obterTile(parentKey);
      if (parentData) {
        return new Promise((resolve) => {
          const pImg = new Image();
          pImg.onload = () => {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = 256;
              canvas.height = 256;
              const ctx = canvas.getContext('2d');

              // Ativa suavização bicúbica para zoom ficar bonito
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';

              const subSize = 256 / fator;
              const sx = (coords.x % fator) * subSize;
              const sy = (coords.y % fator) * subSize;

              // Desenha a sub-região do pai esticada em 256x256
              ctx.drawImage(pImg, sx, sy, subSize, subSize, 0, 0, 256, 256);
              resolve(canvas.toDataURL('image/jpeg', 0.85));
            } catch (err) {
              resolve(null);
            }
          };
          pImg.onerror = () => resolve(null);
          pImg.src = parentData;
        });
      }
    }
    return null;
  },

  async contarBlocosSalvos() {
    try {
      const db = await this.init();
      return new Promise((resolve) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => resolve(0);
      });
    } catch (e) {
      return 0;
    }
  }
};

window.TileDB = TileDB;
