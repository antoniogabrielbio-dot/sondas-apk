/**
 * OTA Patch v4.0 - Sondas 2.0 (Hotfix: Restauração Completa da Renderização do Mapa)
 * 1. Bússola & Ponteiro de Direção estilo Google Maps em Tempo Real
 * 2. Correção definitiva do mapa preto (remoção do override de transform no Leaflet)
 * 3. Sanitização e Correção dos Marcadores e Filtros
 * 4. Satélite HD com Zoom Nativo 20x e fallback suave
 */
(async function() {
  console.log('[OTA v4.0] Aplicando correções do mapa e bússola...');

  // 1. LIMPA QUALQUER ESTILO QUE POSSA TER INTERFERIDO NA POSIÇÃO DOS TILES DO LEAFLET
  const badStyles = ['ota-zoom-hd-styles', 'ota-injected-styles'];
  badStyles.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  // Limpa CSS obsoleto que continha transform: translateZ(0) !important
  try {
    localStorage.removeItem('sondas_ota_css');
    localStorage.removeItem('sondas_ota_persistent_patch_v232');
  } catch (e) {}

  // Remove toast antigo se houver
  const oldToast = document.getElementById('ota-toast');
  if (oldToast) oldToast.remove();

  // 2. CRIA O LOADER VISUAL COM BARRA DE PROGRESSO
  let loader = document.getElementById('ota-loading-overlay');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'ota-loading-overlay';
    loader.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      width: 92%;
      max-width: 440px;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1.5px solid rgba(56, 189, 248, 0.45);
      border-radius: 14px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75), 0 0 20px rgba(56, 189, 248, 0.2);
      padding: 14px 16px;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-sizing: border-box;
      animation: ota-slide-down 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    `;
    document.body.appendChild(loader);
  }

  let animStyle = document.getElementById('ota-loader-styles');
  if (!animStyle) {
    animStyle = document.createElement('style');
    animStyle.id = 'ota-loader-styles';
    animStyle.textContent = `
      @keyframes ota-slide-down {
        from { opacity: 0; transform: translate(-50%, -20px); }
        to { opacity: 1; transform: translate(-50%, 0); }
      }
      @keyframes ota-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(animStyle);
  }

  function setProgress(percent, stepText) {
    loader.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:26px; height:26px; border:3px solid rgba(56,189,248,0.2); border-top-color:#38bdf8; border-radius:50%; animation: ota-spin 0.8s linear infinite; flex-shrink:0;"></div>
          <div>
            <div style="font-size:0.95rem; font-weight:800; color:#38bdf8; letter-spacing:0.3px;">
              ⚡ Atualização Sondas 4.0
            </div>
            <div style="font-size:0.76rem; color:#94a3b8; margin-top:2px;">
              ${stepText}
            </div>
          </div>
        </div>
        <span style="font-size:0.9rem; font-weight:800; color:#38bdf8; font-variant-numeric:tabular-nums;">
          ${percent}%
        </span>
      </div>
      <div style="width:100%; height:7px; background:rgba(255,255,255,0.1); border-radius:10px; overflow:hidden; position:relative;">
        <div style="width:${percent}%; height:100%; background:linear-gradient(90deg, #0284c7, #38bdf8, #10b981); border-radius:10px; transition:width 0.3s ease;"></div>
      </div>
    `;
  }

  // ETAPA 1: 25%
  setProgress(25, 'Restaurando renderização do mapa...');
  await new Promise(r => setTimeout(r, 200));

  // ETAPA 2: 50% - RESTAURAÇÃO DAS CAMADAS SEM CONFLITO DE CSS
  setProgress(50, 'Recarregando camadas de satélite e relevo...');
  try {
    const LocalOfflineTileLayer = L.TileLayer.extend({
      createTile(coords, done) {
        const tile = document.createElement('img');
        tile.setAttribute('role', 'presentation');

        const tipo = this.options.tipo || 'satelite';
        const key = `${tipo}_${coords.z}_${coords.x}_${coords.y}`;

        let isDone = false;
        const finish = (err) => {
          if (!isDone) {
            isDone = true;
            done(err, tile);
          }
        };

        if (window.TileDB) {
          TileDB.obterTile(key).then(cachedData => {
            if (cachedData) {
              tile.onload = () => finish(null);
              tile.onerror = () => finish(null);
              tile.src = cachedData;
              return;
            }
            this._carregarTileOnline(coords, key, tipo, tile, finish);
          }).catch(() => {
            this._carregarTileOnline(coords, key, tipo, tile, finish);
          });
        } else {
          this._carregarTileOnline(coords, key, tipo, tile, finish);
        }

        return tile;
      },

      _carregarTileOnline(coords, key, tipo, tile, finish) {
        const url = this.getTileUrl(coords);
        tile.onload = () => {
          finish(null);
          if (window.TileDB && tile.naturalWidth > 0) {
            TileDB.salvarTileDaImg(key, tile);
          }
        };
        tile.onerror = () => {
          if (window.TileDB) {
            TileDB.buscarBlocoPai(tipo, coords).then(canvasData => {
              if (canvasData) {
                tile.onload = () => finish(null);
                tile.onerror = () => finish(null);
                tile.src = canvasData;
              } else {
                finish(null);
              }
            }).catch(() => finish(null));
          } else {
            finish(null);
          }
        };
        tile.src = url;
      }
    });

    window.LocalOfflineTileLayer = LocalOfflineTileLayer;

    if (window.map) {
      window.map.options.maxZoom = 22;

      const opcoesHD = {
        maxNativeZoom: 20,
        maxZoom: 22,
        keepBuffer: 100
      };

      const camadaAtivaKey = window.camadaAtual || 'satelite';

      // Remove camadas anteriores
      if (window.camadasDisponiveis) {
        Object.keys(window.camadasDisponiveis).forEach(k => {
          if (window.map.hasLayer(window.camadasDisponiveis[k])) {
            window.map.removeLayer(window.camadasDisponiveis[k]);
          }
        });
      }

      window.camadasDisponiveis = {
        satelite: new LocalOfflineTileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
          subdomains: ['0', '1', '2', '3'],
          tipo: 'satelite',
          ...opcoesHD
        }),
        relevo: new LocalOfflineTileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
          subdomains: ['0', '1', '2', '3'],
          tipo: 'relevo',
          maxNativeZoom: 18,
          maxZoom: 22,
          keepBuffer: 100
        }),
        ruas: new LocalOfflineTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          tipo: 'ruas',
          maxNativeZoom: 19,
          maxZoom: 22,
          keepBuffer: 100
        }),
        satelite_puro: new LocalOfflineTileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
          subdomains: ['0', '1', '2', '3'],
          tipo: 'satelite_puro',
          ...opcoesHD
        })
      };

      if (window.camadasDisponiveis[camadaAtivaKey]) {
        window.camadasDisponiveis[camadaAtivaKey].addTo(window.map);
      }

      // Força o Leaflet a recalcular posições e redesenhar tiles
      setTimeout(() => {
        window.map.invalidateSize();
      }, 100);
    }
  } catch (e) {
    console.warn('[OTA v4.0] Erro ao recarregar camadas:', e);
  }
  await new Promise(r => setTimeout(r, 250));

  // ETAPA 3: 75% - BÚSSOLA & PONTEIRO GOOGLE MAPS
  setProgress(75, 'Ativando Bússola e Ponteiro estilo Google Maps...');
  try {
    let compassStyle = document.getElementById('ota-compass-styles');
    if (!compassStyle) {
      compassStyle = document.createElement('style');
      compassStyle.id = 'ota-compass-styles';
      document.head.appendChild(compassStyle);
    }
    compassStyle.textContent = `
      .google-maps-hunter-wrapper {
        background: transparent !important;
        border: none !important;
      }
      .google-hunter-marker {
        position: relative;
        width: 60px;
        height: 60px;
        pointer-events: none;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .heading-beam-wrapper {
        position: absolute;
        top: 0;
        left: 0;
        width: 60px;
        height: 60px;
        transform-origin: 30px 30px;
        pointer-events: none;
        transition: transform 0.12s linear;
      }
      .heading-cone {
        position: absolute;
        top: 0px;
        left: 6px;
        width: 48px;
        height: 30px;
        clip-path: polygon(50% 100%, 0% 0%, 100% 0%);
        background: linear-gradient(to top, rgba(56, 189, 248, 0.7) 0%, rgba(56, 189, 248, 0.05) 90%, rgba(56, 189, 248, 0) 100%);
        filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.7));
      }
      .heading-arrow {
        position: absolute;
        top: -4px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 11px;
        color: #38bdf8;
        filter: drop-shadow(0 0 4px #0284c7);
        line-height: 1;
      }
      .hunter-core-dot {
        position: absolute;
        top: 22px;
        left: 22px;
        width: 16px;
        height: 16px;
        background: #0284c7;
        border: 3px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 0 10px rgba(2, 132, 199, 0.8), 0 2px 6px rgba(0,0,0,0.5);
        z-index: 2;
      }
      .hunter-pulse-ring {
        position: absolute;
        top: 17px;
        left: 17px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 1.5px solid #38bdf8;
        animation: ota-pulse-ring 2s cubic-bezier(0.2, 0.8, 0.2, 1) infinite;
        z-index: 1;
      }
      @keyframes ota-pulse-ring {
        0% { transform: scale(0.6); opacity: 0.9; }
        100% { transform: scale(2.2); opacity: 0; }
      }
    `;

    window.compassHeading = null;
    window.compassOrientationListener = null;

    window.ativarBussolaCelular = function() {
      if (window.compassOrientationListener) return;
      const processOrientation = (e) => {
        let heading = null;
        if (e.webkitCompassHeading !== undefined) {
          heading = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
          heading = (360 - e.alpha) % 360;
        }
        if (heading !== null && !isNaN(heading)) {
          window.compassHeading = Math.round(heading);
          window.atualizarRotacaoPonteiro(window.compassHeading);
        }
      };

      if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', processOrientation, true);
        window.compassOrientationListener = { event: 'deviceorientationabsolute', handler: processOrientation };
      } else if ('ondeviceorientation' in window) {
        window.addEventListener('deviceorientation', processOrientation, true);
        window.compassOrientationListener = { event: 'deviceorientation', handler: processOrientation };
      }
    };

    window.desativarBussolaCelular = function() {
      if (window.compassOrientationListener) {
        window.removeEventListener(window.compassOrientationListener.event, window.compassOrientationListener.handler, true);
        window.compassOrientationListener = null;
      }
    };

    window.atualizarRotacaoPonteiro = function(graus) {
      const beam = document.getElementById('hunter-heading-beam');
      if (beam) {
        beam.style.transform = `rotate(${graus}deg)`;
      }
      if (typeof window.atualizarHudCacada === 'function') {
        window.atualizarHudCacada();
      }
    };

    const originalAtualizarHudCacada = window.atualizarHudCacada;
    window.atualizarHudCacada = function() {
      const hud = document.getElementById('hunter-hud');
      if (!window.selectedSonda || !window.hunterPosition) {
        if (hud) hud.style.display = 'none';
        return;
      }
      if (originalAtualizarHudCacada) {
        try { originalAtualizarHudCacada(); } catch (e) {}
      }
      const elRumo = document.getElementById('hud-rumo');
      if (elRumo && typeof calcularRumoEDistancia === 'function') {
        const res = calcularRumoEDistancia(
          window.hunterPosition.lat, window.hunterPosition.lon,
          window.selectedSonda.latitude, window.selectedSonda.longitude
        );
        let rumoTxt = `Rumo: ${res.azimuteGraus}° (${res.pontoCardinal})`;
        if (window.compassHeading !== null) {
          const diff = Math.abs((res.azimuteGraus - window.compassHeading + 180) % 360 - 180);
          if (diff <= 18) {
            rumoTxt += ` • <span style="color:#10b981; font-weight:800;">🎯 NA MIRA!</span>`;
          } else {
            rumoTxt += ` • Celular: ${window.compassHeading}°`;
          }
        }
        elRumo.innerHTML = rumoTxt;
      }
    };

    const googleHunterIcon = L.divIcon({
      className: 'google-maps-hunter-wrapper',
      html: `
        <div class="google-hunter-marker">
          <div id="hunter-heading-beam" class="heading-beam-wrapper" style="transform: rotate(${window.compassHeading || 0}deg);">
            <div class="heading-cone"></div>
            <div class="heading-arrow">▲</div>
          </div>
          <div class="hunter-core-dot"></div>
          <div class="hunter-pulse-ring"></div>
        </div>
      `,
      iconSize: [60, 60],
      iconAnchor: [30, 30]
    });

    if (window.hunterMarker) {
      window.hunterMarker.setIcon(googleHunterIcon);
      window.ativarBussolaCelular();
    }

    const originalToggleHunterGPS = window.toggleHunterGPS;
    window.toggleHunterGPS = function() {
      if (window.hunterWatchId !== null) {
        window.desativarBussolaCelular();
        window.compassHeading = null;
        if (originalToggleHunterGPS) originalToggleHunterGPS();
      } else {
        if (originalToggleHunterGPS) originalToggleHunterGPS();
        window.ativarBussolaCelular();
        setTimeout(() => {
          if (window.hunterMarker) {
            window.hunterMarker.setIcon(googleHunterIcon);
          }
        }, 150);
      }
    };
  } catch (e) {
    console.warn('[OTA v4.0] Erro bússola:', e);
  }
  await new Promise(r => setTimeout(r, 200));

  // ETAPA 4: 90% - SANITIZAÇÃO DE DADOS
  setProgress(90, 'Limpando e restaurando marcadores...');
  try {
    const sondasCache = localStorage.getItem('sondas_cache_local');
    if (sondasCache) {
      let lista = JSON.parse(sondasCache);
      if (Array.isArray(lista)) {
        let alterou = false;
        lista.forEach(s => {
          if (s.status && typeof s.status === 'string' && s.status.includes('<')) {
            s.status = s.status.replace(/<[^>]*>?/gm, '').trim();
            alterou = true;
          }
          if (s._patched) {
            delete s._patched;
            alterou = true;
          }
        });
        if (alterou) {
          localStorage.setItem('sondas_cache_local', JSON.stringify(lista));
        }
      }
    }

    if (window.allSondas && Array.isArray(window.allSondas)) {
      window.allSondas.forEach(s => {
        if (s.status && typeof s.status === 'string' && s.status.includes('<')) {
          s.status = s.status.replace(/<[^>]*>?/gm, '').trim();
        }
        delete s._patched;
      });
      if (typeof window.atualizarEstatisticas === 'function') window.atualizarEstatisticas();
      if (typeof window.renderizarMarcadores === 'function') window.renderizarMarcadores();
    }
  } catch (e) {}

  // ETAPA 5: 100% - CONCLUÍDO
  setProgress(100, 'Mapa e Bússola Restaurados!');
  await new Promise(r => setTimeout(r, 400));

  loader.innerHTML = `
    <div style="display:flex; align-items:flex-start; gap:12px;">
      <span style="font-size:1.6rem; line-height:1;">✅</span>
      <div style="flex:1;">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <b style="color:#10b981; font-size:1.02rem; letter-spacing:0.2px;">Mapa Restaurado (v4.0.1)!</b>
        </div>
        <div style="font-size:0.78rem; color:#cbd5e1; margin-top:5px; line-height:1.45;">
          • <b>Renderização Corrigida:</b> O mapa agora carrega perfeitamente em qualquer zoom.<br>
          • <b>Bússola Ativa:</b> Feixe de lanterna azul no GPS acompanhando o celular.<br>
          • <b>Alta Definição:</b> Satélite 20x com imagens nítidas.
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:10px;">
          <button id="btn-ota-done" style="background:linear-gradient(135deg, #10b981, #059669); color:#fff; border:none; border-radius:8px; padding:6px 16px; font-size:0.82rem; font-weight:700; cursor:pointer; box-shadow:0 3px 10px rgba(16,185,129,0.4);">
            OK
          </button>
        </div>
      </div>
    </div>
  `;

  const btnDone = document.getElementById('btn-ota-done');
  if (btnDone) {
    btnDone.onclick = () => {
      loader.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      loader.style.opacity = '0';
      loader.style.transform = 'translate(-50%, -20px)';
      setTimeout(() => loader.remove(), 400);
    };
  }

  setTimeout(() => {
    if (loader && loader.parentElement) {
      loader.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
      loader.style.opacity = '0';
      loader.style.transform = 'translate(-50%, -20px)';
      setTimeout(() => loader.remove(), 500);
    }
  }, 6000);

  console.log('[OTA v4.0] Correções aplicadas com sucesso!');
})();
