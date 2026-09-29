/**
 * Sondas 2.0 - Core Application Logic
 * Interface Web PWA com Leaflet, Cache Offline e Caçada em Tempo Real
 */

let map = null;
let allSondas = [];
let markerCluster = [];
let activeMarkers = [];
let selectedSonda = null;
// Padrão: Pendentes e Reciosas visíveis ao mesmo tempo para caçada!
let activeStatusFilters = new Set(['Pendente', 'Recioso']);

// GPS do Caçador
let hunterMarker = null;
let hunterAccuracyCircle = null;
let hunterWatchId = null;
let hunterPosition = null;
let huntTrackingLine = null;

// Camadas de Mapa
let osmLayer = null;
let topoLayer = null;
let satLayer = null;

document.addEventListener('DOMContentLoaded', () => {
  initServiceWorker();
  initMap();
  initEventListeners();
  SyncEngine.iniciar();
});

// =========================================================
// 1. AUTO-SYNC ENGINE (SINCRONIZAÇÃO EM TEMPO REAL E OFFLINE)
// =========================================================
const SyncEngine = {
  ultimaSincronizacao: null,
  timer: null,

  iniciar() {
    this.carregarDadosLocais();
    this.sincronizar();

    // Sincroniza a cada 20 segundos em segundo plano quando conectado
    this.timer = setInterval(() => {
      if (navigator.onLine) {
        this.sincronizar();
      }
    }, 20000);

    // Eventos de conectividade do celular
    window.addEventListener('online', () => {
      console.log('[SYNC] Conexão detectada! Enviando dados pendentes e atualizando...');
      this.drenarFilaOffline();
      this.sincronizar();
    });

    window.addEventListener('offline', () => {
      console.log('[SYNC] Dispositivo offline. Usando dados salvos na memória.');
      this.atualizarBadgeUI(false);
    });
  },

  carregarDadosLocais() {
    const cache = localStorage.getItem('sondas_cache_local');
    if (cache) {
      try {
        allSondas = JSON.parse(cache);
        // Sanitiza qualquer resquício de tag HTML em status e limpa flags antigas
        if (Array.isArray(allSondas)) {
          let dirty = false;
          allSondas.forEach(s => {
            if (s.status && typeof s.status === 'string' && s.status.includes('<')) {
              s.status = s.status.replace(/<[^>]*>?/gm, '').trim();
              dirty = true;
            }
            if (s._patched) {
              delete s._patched;
              dirty = true;
            }
          });
          if (dirty) {
            localStorage.setItem('sondas_cache_local', JSON.stringify(allSondas));
          }
        }

        // Aplica alterações offline pendentes
        const fila = this.obterFilaOffline();
        Object.keys(fila).forEach(cod => {
          const item = allSondas.find(s => s.codigo === cod);
          if (item) item.status = fila[cod].status;
        });
        atualizarEstatisticas();
        renderizarMarcadores();
      } catch (e) {}
    }
  },

  async sincronizar() {
    if (!navigator.onLine) {
      this.atualizarBadgeUI(false);
      return;
    }

    try {
      // 1. Envia alterações feitas offline se houver
      await this.drenarFilaOffline();

      // 2. Busca dados atualizados da nuvem (Supabase ou API local)
      let dadosNovos = null;
      try {
        const resLocal = await fetch('/api/sondas');
        if (resLocal.ok) dadosNovos = await resLocal.json();
      } catch (e) {}

      if (!dadosNovos) {
        const resSb = await fetch('https://fiprihngxupdlvluhxht.supabase.co/rest/v1/sondas?select=*', {
          headers: {
            'apikey': 'sb_publishable_ToQhrymy2DktpzHdhty-AQ_U8SSg8MV',
            'Authorization': 'Bearer sb_publishable_ToQhrymy2DktpzHdhty-AQ_U8SSg8MV'
          }
        });
        if (resSb.ok) dadosNovos = await resSb.json();
      }

      if (dadosNovos && Array.isArray(dadosNovos)) {
        allSondas = dadosNovos;
        localStorage.setItem('sondas_cache_local', JSON.stringify(allSondas));
        this.ultimaSincronizacao = new Date();
        localStorage.setItem('sondas_last_sync_time', this.ultimaSincronizacao.toISOString());

        atualizarEstatisticas();
        renderizarMarcadores();
        this.atualizarBadgeUI(true);
      }
    } catch (err) {
      console.warn('[SYNC] Erro na sincronização:', err);
      this.atualizarBadgeUI(false);
    }
  },

  salvarAlteracaoOffline(codigo, novoStatus) {
    const fila = this.obterFilaOffline();
    fila[codigo] = { status: novoStatus, timestamp: new Date().toISOString() };
    localStorage.setItem('sondas_offline_queue', JSON.stringify(fila));
  },

  obterFilaOffline() {
    try {
      return JSON.parse(localStorage.getItem('sondas_offline_queue')) || {};
    } catch (e) {
      return {};
    }
  },

  async drenarFilaOffline() {
    const fila = this.obterFilaOffline();
    const codigos = Object.keys(fila);
    if (codigos.length === 0) return;

    for (const cod of codigos) {
      const st = fila[cod].status;
      try {
        // Tenta enviar para API local
        let enviado = false;
        try {
          const res = await fetch('/api/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo: cod, status: st })
          });
          if (res.ok) enviado = true;
        } catch (e) {}

        // Se local falhar, tenta direto no Supabase
        if (!enviado && navigator.onLine) {
          const resSb = await fetch(`https://fiprihngxupdlvluhxht.supabase.co/rest/v1/sondas?codigo=eq.${cod}`, {
            method: 'PATCH',
            headers: {
              'apikey': 'sb_publishable_ToQhrymy2DktpzHdhty-AQ_U8SSg8MV',
              'Authorization': 'Bearer sb_publishable_ToQhrymy2DktpzHdhty-AQ_U8SSg8MV',
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ status: st })
          });
          if (resSb.ok) enviado = true;
        }

        if (enviado) {
          delete fila[cod];
        }
      } catch (err) {}
    }
    localStorage.setItem('sondas_offline_queue', JSON.stringify(fila));
  },

  atualizarBadgeUI(online) {
    const badge = document.getElementById('network-badge');
    if (!badge) return;

    const dataHora = this.ultimaSincronizacao || 
      (localStorage.getItem('sondas_last_sync_time') ? new Date(localStorage.getItem('sondas_last_sync_time')) : null);

    const horaStr = dataHora ? dataHora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

    if (online && navigator.onLine) {
      badge.className = 'net-status net-online';
      badge.innerHTML = `<span class="net-dot"></span> Sincronizado ${horaStr ? '(' + horaStr + ')' : ''}`;
    } else {
      badge.className = 'net-status net-offline';
      badge.innerHTML = `<span class="net-dot"></span> Offline ${horaStr ? '(' + horaStr + ')' : ''}`;
    }
  }
};

function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('Service Worker ativo:', reg.scope))
      .catch(err => console.warn('Falha Service Worker:', err));
  }
}

// =========================================================
// 2. INICIALIZAÇÃO DO MAPA LEAFLET E CAMADAS BLINDADAS (INDEXEDDB)
// =========================================================
let camadasDisponiveis = {};
let camadaAtual = localStorage.getItem('sondas_camada_preferida') || 'satelite';

// Camada Offline Nativa com suporte a IndexedDB (TileDB) e interpolação Canvas de blocos pais
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

    // 1. Se estiver salvo no IndexedDB (modo offline), carrega imediatamente
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
      // Salva silenciosamente no IndexedDB para uso futuro no campo
      if (window.TileDB && tile.naturalWidth > 0) {
        TileDB.salvarTileDaImg(key, tile);
      }
    };

    tile.onerror = () => {
      // Se estiver offline ou sem sinal na mata, busca bloco pai escalado no IndexedDB
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

function criarCamadasMapas() {
  const opcoesHD = {
    maxNativeZoom: 20, // Google possui fotos aéreas reais até zoom 20 na região!
    maxZoom: 22,
    keepBuffer: 100,
    updateWhenZooming: false,
    updateWhenIdle: true
  };

  camadasDisponiveis = {
    // 1. Google Satélite Híbrido (fotos aéreas HD nativas com nomes de estradas e rios)
    satelite: new LocalOfflineTileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      tipo: 'satelite',
      ...opcoesHD
    }),
    // 2. Google Relevo / Topografia (curvas de nível e relevo sombreado 3D da mata)
    relevo: new LocalOfflineTileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      tipo: 'relevo',
      maxNativeZoom: 18,
      maxZoom: 22,
      keepBuffer: 100
    }),
    // 3. OpenStreetMap (Ruas, cidades e vicinais em alta resolução)
    ruas: new LocalOfflineTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      tipo: 'ruas',
      maxNativeZoom: 19,
      maxZoom: 22,
      keepBuffer: 100
    }),
    // 4. Google Satélite Puro (sem rótulos para ver copas das árvores e clareiras)
    satelite_puro: new LocalOfflineTileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      tipo: 'satelite_puro',
      ...opcoesHD
    })
  };
}

function mudarEstiloMapa(chave) {
  if (!camadasDisponiveis[chave]) return;

  // Remove a camada anterior se estiver no mapa
  Object.keys(camadasDisponiveis).forEach(k => {
    if (k !== chave && map.hasLayer(camadasDisponiveis[k])) {
      map.removeLayer(camadasDisponiveis[k]);
    }
  });

  // Adiciona a nova camada se ainda não estiver
  if (!map.hasLayer(camadasDisponiveis[chave])) {
    camadasDisponiveis[chave].addTo(map);
  }

  camadaAtual = chave;
  localStorage.setItem('sondas_camada_preferida', chave);

  // Atualiza visual dos cards de seleção
  document.querySelectorAll('.layer-option-card').forEach(card => {
    card.classList.toggle('active', card.getAttribute('data-layer') === chave);
  });

  // Atualiza o ícone do botão FAB de camadas
  const fabIcon = document.getElementById('fab-camada-icon');
  const icones = { satelite: '🛰️', relevo: '🏔️', ruas: '🗺️', satelite_puro: '📷' };
  if (fabIcon && icones[chave]) {
    fabIcon.innerText = icones[chave];
  }
}

function initMap() {
  const defaultCenter = [-2.445, -54.725];
  const defaultZoom = 11;

  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    maxZoom: 22
  }).setView(defaultCenter, defaultZoom);

  // Zoom no canto inferior esquerdo (para não conflitar com a coluna tática FAB na direita)
  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  // Fecha gaveta inferior ao tocar em qualquer área livre do mapa
  map.on('click', () => {
    fecharGaveta();
  });

  criarCamadasMapas();

  // Ativa a camada preferida salva (padrão: Satélite Híbrido)
  if (!camadasDisponiveis[camadaAtual]) camadaAtual = 'satelite';
  camadasDisponiveis[camadaAtual].addTo(map);
  mudarEstiloMapa(camadaAtual);
}

// =========================================================
// 3. CARREGAMENTO DAS SONDAS
// =========================================================
async function carregarSondas() {
  let carregou = false;

  // 1. Tenta API do servidor local
  try {
    const res = await fetch('/api/sondas');
    if (res.ok) {
      const dados = await res.json();
      allSondas = Array.isArray(dados) ? dados : (dados.sondas || []);
      localStorage.setItem('sondas_cache_local', JSON.stringify(allSondas));
      carregou = true;
    }
  } catch (err) {}

  // 2. Se não estiver no computador, busca direto do Supabase via 4G/Wi-Fi
  if (!carregou && navigator.onLine) {
    try {
      const resSb = await fetch('https://fiprihngxupdlvluhxht.supabase.co/rest/v1/sondas?select=*', {
        headers: {
          'apikey': 'sb_publishable_ToQhrymy2DktpzHdhty-AQ_U8SSg8MV',
          'Authorization': 'Bearer sb_publishable_ToQhrymy2DktpzHdhty-AQ_U8SSg8MV'
        }
      });
      if (resSb.ok) {
        allSondas = await resSb.json();
        localStorage.setItem('sondas_cache_local', JSON.stringify(allSondas));
        carregou = true;
      }
    } catch (errSb) {}
  }

  // 3. Modo 100% Offline (na mata): Carrega da memória local do celular
  if (!carregou) {
    const cache = localStorage.getItem('sondas_cache_local');
    if (cache) {
      allSondas = JSON.parse(cache);
    }
  }

  atualizarEstatisticas();
  renderizarMarcadores();
}

// =========================================================
// 4. RENDERIZAÇÃO DE MARCADORES
// =========================================================
function criarIconeSonda(status, codigo) {
  let pinClass = 'pin-pendente';
  let emoji = '📍';

  if (status === 'Coletada') {
    pinClass = 'pin-coletada';
    emoji = '✅';
  } else if (status === 'Recioso') {
    pinClass = 'pin-recioso';
    emoji = '⚠️';
  } else if (status === 'Inviável/Perdida') {
    pinClass = 'pin-perdida';
    emoji = '❌';
  }

  return L.divIcon({
    className: 'custom-div-icon',
    html: `<div class="custom-pin ${pinClass}"><span>${emoji}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -32]
  });
}

function renderizarMarcadores() {
  // Limpa marcadores anteriores
  activeMarkers.forEach(m => map.removeLayer(m));
  activeMarkers = [];

  const termoBusca = (document.getElementById('search-input')?.value || '').trim().toUpperCase();

  const filtradas = allSondas.filter(s => {
    // Filtro por múltiplos status simultâneos
    if (!activeStatusFilters.has('todos') && !activeStatusFilters.has(s.status)) {
      return false;
    }
    // Filtro por busca de código
    if (termoBusca && !s.codigo?.toUpperCase().includes(termoBusca)) {
      return false;
    }
    return true;
  });

  filtradas.forEach(sonda => {
    if (!sonda.latitude || !sonda.longitude) return;

    const icone = criarIconeSonda(sonda.status, sonda.codigo);
    const marker = L.marker([sonda.latitude, sonda.longitude], { icon: icone });

    marker.on('click', () => {
      abrirGavetaSonda(sonda);
    });

    marker.bindTooltip(`<b>${sonda.codigo}</b><br>${sonda.status}`, {
      direction: 'top',
      offset: [0, -28]
    });

    marker.addTo(map);
    activeMarkers.push(marker);
  });
}

function atualizarEstatisticas() {
  let total = allSondas.length;
  let pendentes = 0;
  let reciosas = 0;
  let coletadas = 0;
  let perdidas = 0;

  allSondas.forEach(s => {
    if (s.status === 'Pendente') pendentes++;
    else if (s.status === 'Recioso') reciosas++;
    else if (s.status === 'Coletada') coletadas++;
    else if (s.status === 'Inviável/Perdida') perdidas++;
  });

  const setHtml = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
  };

  setHtml('badge-total-count', total);
  setHtml('badge-busca-count', pendentes + reciosas);
  setHtml('badge-pendente-count', pendentes);
  setHtml('badge-recioso-count', reciosas);
  setHtml('badge-coletada-count', coletadas);
  setHtml('badge-perdida-count', perdidas);
}

// =========================================================
// 5. GAVETA DE DETALHES DA SONDA (DRAWER)
// =========================================================
function abrirGavetaSonda(sonda) {
  selectedSonda = sonda;

  document.getElementById('drawer-codigo').innerText = sonda.codigo || 'Sem Código';
  
  // Badge de Status
  const statusEl = document.getElementById('drawer-status-badge');
  statusEl.innerText = sonda.status;
  statusEl.className = 'badge ' + 
    (sonda.status === 'Pendente' ? 'badge-pendente active' :
     sonda.status === 'Recioso' ? 'badge-recioso active' :
     sonda.status === 'Coletada' ? 'badge-coletada active' : 'badge-perdida active');

  document.getElementById('stat-data').innerText = sonda.data || '--';
  document.getElementById('stat-altitude').innerText = (sonda.altitude !== undefined) ? `${sonda.altitude} m` : '--';
  document.getElementById('stat-coordenadas').innerText = `${Number(sonda.latitude).toFixed(5)}, ${Number(sonda.longitude).toFixed(5)}`;
  
  const vz = sonda.velocidade_vertical !== undefined ? `${sonda.velocidade_vertical} m/s` : '--';
  const vh = sonda.velocidade_horizontal !== undefined ? `${sonda.velocidade_horizontal} m/s` : '--';
  document.getElementById('stat-velocidades').innerText = `V: ${vz} | H: ${vh}`;

  // Configura Links de Navegação
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${sonda.latitude},${sonda.longitude}`;
  document.getElementById('btn-nav-maps').href = mapsUrl;

  const geoUrl = `geo:${sonda.latitude},${sonda.longitude}?q=${sonda.latitude},${sonda.longitude}(Sonda_${sonda.codigo})`;
  document.getElementById('btn-nav-offline').href = geoUrl;

  // Atualiza HUD de Caçada se o GPS estiver ativo
  atualizarHudCacada();

  // Abre a gaveta
  document.getElementById('sonde-drawer').classList.add('open');
}

function fecharGaveta() {
  document.getElementById('sonde-drawer').classList.remove('open');
}

// =========================================================
// 6. MUDANÇA DE STATUS DA SONDA
// =========================================================
async function alterarStatus(novoStatus) {
  if (!selectedSonda) return;

  const codigo = selectedSonda.codigo;
  selectedSonda.status = novoStatus;

  // Atualiza array local
  const item = allSondas.find(s => s.codigo === codigo);
  if (item) item.status = novoStatus;

  // Salva no LocalStorage
  localStorage.setItem('sondas_cache_local', JSON.stringify(allSondas));

  // Tenta sincronizar com o backend local ou direto com o Supabase
  try {
    const res = await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: codigo, status: novoStatus })
    });
    if (!res.ok) throw new Error('Offline local');
  } catch (e) {
    if (navigator.onLine) {
      try {
        await fetch(`https://fiprihngxupdlvluhxht.supabase.co/rest/v1/sondas?codigo=eq.${codigo}`, {
          method: 'PATCH',
          headers: {
            'apikey': 'sb_publishable_ToQhrymy2DktpzHdhty-AQ_U8SSg8MV',
            'Authorization': 'Bearer sb_publishable_ToQhrymy2DktpzHdhty-AQ_U8SSg8MV',
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ status: novoStatus })
        });
      } catch (errSb) {
        SyncEngine.salvarAlteracaoOffline(codigo, novoStatus);
      }
    } else {
      SyncEngine.salvarAlteracaoOffline(codigo, novoStatus);
    }
  }

  atualizarEstatisticas();
  renderizarMarcadores();
  abrirGavetaSonda(selectedSonda);
}

// =========================================================
// 7. MODO CAÇADA - GPS DO CAÇADOR & BÚSSOLA ESTILO GOOGLE MAPS
// =========================================================
let compassHeading = null;
let compassOrientationListener = null;

function ativarBussolaCelular() {
  if (compassOrientationListener) return;

  const processOrientation = (e) => {
    let heading = null;
    if (e.webkitCompassHeading !== undefined) {
      // iOS
      heading = e.webkitCompassHeading;
    } else if (e.alpha !== null) {
      // Android Chrome / WebView
      heading = (360 - e.alpha) % 360;
    }

    if (heading !== null && !isNaN(heading)) {
      compassHeading = Math.round(heading);
      atualizarRotacaoPonteiro(compassHeading);
    }
  };

  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', processOrientation, true);
    compassOrientationListener = { event: 'deviceorientationabsolute', handler: processOrientation };
  } else if ('ondeviceorientation' in window) {
    window.addEventListener('deviceorientation', processOrientation, true);
    compassOrientationListener = { event: 'deviceorientation', handler: processOrientation };
  }
}

function desativarBussolaCelular() {
  if (compassOrientationListener) {
    window.removeEventListener(compassOrientationListener.event, compassOrientationListener.handler, true);
    compassOrientationListener = null;
  }
}

function atualizarRotacaoPonteiro(graus) {
  const beam = document.getElementById('hunter-heading-beam');
  if (beam) {
    beam.style.transform = `rotate(${graus}deg)`;
  }
  atualizarHudCacada();
}

function toggleHunterGPS() {
  const btn = document.getElementById('btn-hunter-gps');
  const icon = document.getElementById('fab-gps-icon');

  if (hunterWatchId !== null) {
    // Desliga GPS e Bússola
    navigator.geolocation.clearWatch(hunterWatchId);
    hunterWatchId = null;
    desativarBussolaCelular();
    compassHeading = null;

    if (hunterMarker) map.removeLayer(hunterMarker);
    if (hunterAccuracyCircle) map.removeLayer(hunterAccuracyCircle);
    if (huntTrackingLine) map.removeLayer(huntTrackingLine);
    hunterMarker = null;
    hunterAccuracyCircle = null;
    huntTrackingLine = null;
    document.getElementById('hunter-hud').style.display = 'none';
    if (btn) {
      btn.classList.remove('active', 'fab-active');
      btn.title = 'Ativar GPS e Radar de Caçada';
    }
    if (icon) icon.innerText = '🧭';
    return;
  }

  if (!('geolocation' in navigator)) {
    alert('Geolocalização não suportada neste dispositivo.');
    return;
  }

  if (btn) {
    btn.classList.add('active', 'fab-active');
    btn.title = 'GPS & Bússola Ativos (Toque para desligar)';
  }
  if (icon) icon.innerText = '🛰️';

  // Inicia detecção contínua da orientação magnética do aparelho
  ativarBussolaCelular();

  hunterWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      hunterPosition = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };

      const latlng = [hunterPosition.lat, hunterPosition.lon];

      if (!hunterMarker) {
        // Marcador Google Maps com Feixe de Lanterna / Ponteiro de Direção
        const icon = L.divIcon({
          className: 'google-maps-hunter-wrapper',
          html: `
            <div class="google-hunter-marker">
              <div id="hunter-heading-beam" class="heading-beam-wrapper" style="transform: rotate(${compassHeading || 0}deg);">
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
        hunterMarker = L.marker(latlng, { icon: icon }).addTo(map);
        hunterAccuracyCircle = L.circle(latlng, {
          radius: pos.coords.accuracy,
          color: '#38bdf8',
          fillColor: '#38bdf8',
          fillOpacity: 0.15,
          weight: 1
        }).addTo(map);

        map.setView(latlng, 15);
      } else {
        hunterMarker.setLatLng(latlng);
        hunterAccuracyCircle.setLatLng(latlng);
        hunterAccuracyCircle.setRadius(pos.coords.accuracy);
      }

      // Se o sensor magnético não fornecer heading, usa o heading do GPS ao caminhar
      if (pos.coords.heading !== null && !isNaN(pos.coords.heading) && pos.coords.heading >= 0) {
        if (compassHeading === null) {
          atualizarRotacaoPonteiro(Math.round(pos.coords.heading));
        }
      }

      atualizarHudCacada();
    },
    (err) => {
      console.warn('Erro ao obter GPS:', err);
      alert('Não foi possível obter a posição GPS. Verifique a permissão no aparelho.');
      toggleHunterGPS();
    },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 12000 }
  );
}

function calcularDistanciaRumo(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Raio da Terra em metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const dist = R * c;

  // Rumo / Azimute
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  brng = (brng + 360) % 360;

  const cardinais = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO', 'N'];
  const index = Math.round(brng / 45);
  const pontoCardinal = cardinais[index];

  return { distanciaMetros: Math.round(dist), azimuteGraus: Math.round(brng), pontoCardinal };
}

function atualizarHudCacada() {
  const hud = document.getElementById('hunter-hud');

  if (!hunterPosition || !selectedSonda) {
    hud.style.display = 'none';
    if (huntTrackingLine) map.removeLayer(huntTrackingLine);
    return;
  }

  const pCaçador = [hunterPosition.lat, hunterPosition.lon];
  const pSonda = [selectedSonda.latitude, selectedSonda.longitude];

  // Linha traçada entre o Caçador e a Sonda
  if (!huntTrackingLine) {
    huntTrackingLine = L.polyline([pCaçador, pSonda], {
      color: '#38bdf8',
      weight: 3,
      dashArray: '5, 5'
    }).addTo(map);
  } else {
    huntTrackingLine.setLatLngs([pCaçador, pSonda]);
  }

  const res = calcularDistanciaRumo(
    hunterPosition.lat, hunterPosition.lon,
    selectedSonda.latitude, selectedSonda.longitude
  );

  document.getElementById('hud-sonda-nome').innerText = `🎯 Alvo: ${selectedSonda.codigo}`;
  
  if (res.distanciaMetros >= 1000) {
    document.getElementById('hud-distancia').innerText = `${(res.distanciaMetros / 1000).toFixed(2)} km`;
  } else {
    document.getElementById('hud-distancia').innerText = `${res.distanciaMetros} m`;
  }

  let rumoTxt = `Rumo: ${res.azimuteGraus}° (${res.pontoCardinal})`;
  if (compassHeading !== null) {
    // Calcula diferença angular para conferir se o celular está alinhado com o alvo
    const diff = Math.abs((res.azimuteGraus - compassHeading + 180) % 360 - 180);
    if (diff <= 18) {
      rumoTxt += ` • <span style="color:#10b981; font-weight:800;">🎯 NA MIRA!</span>`;
    } else {
      rumoTxt += ` • Celular: ${compassHeading}°`;
    }
  }
  document.getElementById('hud-rumo').innerHTML = rumoTxt;
  hud.style.display = 'block';
}

// =========================================================
// 8. TRAJETÓRIA E PREDIÇÃO DE QUEDA
// =========================================================
async function verTrajetoriaSonda() {
  if (!selectedSonda) return;

  const sonda = selectedSonda;
  const predicao = TrajetoriaEngine.calcularPontoQueda(sonda);
  TrajetoriaEngine.plotarPredicao(map, sonda, predicao);

  // Tenta carregar rastro real se houver arquivo de telemetria
  try {
    const res = await fetch(`/api/trajetoria/${sonda.codigo}`);
    if (res.ok) {
      const pontos = await res.json();
      if (pontos && pontos.length > 1) {
        TrajetoriaEngine.plotarRastroTelemetria(map, pontos);
      }
    }
  } catch (e) {
    console.log('Rastro detalhado de telemetria não disponível para esta sonda.');
  }

  fecharGaveta();
}

// =========================================================
// 9. EVENT LISTENERS & MODAL OFFLINE
// =========================================================
function initEventListeners() {
  // Filtros de status (Suporte a visualização simultânea e individual)
  const badges = document.querySelectorAll('#filter-badges-row .badge, #filter-badges-row .chip');

  function atualizarVisualBadges() {
    badges.forEach(b => {
      const status = b.getAttribute('data-status');
      if (status === 'busca') {
        const isBusca = activeStatusFilters.has('Pendente') && 
                        activeStatusFilters.has('Recioso') && 
                        activeStatusFilters.size === 2;
        b.classList.toggle('active', isBusca);
      } else if (status === 'todos') {
        b.classList.toggle('active', activeStatusFilters.has('todos') || activeStatusFilters.size === 4);
      } else {
        b.classList.toggle('active', activeStatusFilters.has(status));
      }
    });
  }

  badges.forEach(badge => {
    badge.addEventListener('click', () => {
      const status = badge.getAttribute('data-status');

      if (status === 'busca') {
        // Ativa ambos simultaneamente: Pendente e Recioso
        activeStatusFilters = new Set(['Pendente', 'Recioso']);
      } else if (status === 'todos') {
        activeStatusFilters = new Set(['todos']);
      } else {
        // Se estava em "todos", limpa e deixa só o clicado
        if (activeStatusFilters.has('todos')) {
          activeStatusFilters.clear();
        }

        // Toggle do status específico
        if (activeStatusFilters.has(status)) {
          activeStatusFilters.delete(status);
          if (activeStatusFilters.size === 0) {
            activeStatusFilters.add('todos');
          }
        } else {
          activeStatusFilters.add(status);
        }
      }

      atualizarVisualBadges();
      renderizarMarcadores();
    });
  });

  atualizarVisualBadges();

  // Busca rápida de código e botão de limpar busca
  const searchInput = document.getElementById('search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');

  const atualizarVisibilidadeLimpar = () => {
    if (btnClearSearch) {
      btnClearSearch.style.display = searchInput && searchInput.value.trim() ? 'block' : 'none';
    }
  };

  searchInput?.addEventListener('input', () => {
    atualizarVisibilidadeLimpar();
    renderizarMarcadores();
  });

  btnClearSearch?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      atualizarVisibilidadeLimpar();
      renderizarMarcadores();
      searchInput.focus();
    }
  });

  // Alternar recolher/mostrar filtros para tela do mapa 100% limpa
  const filterRow = document.getElementById('filter-badges-row');
  const toggleArrow = document.getElementById('toggle-arrow');
  document.getElementById('btn-toggle-filters')?.addEventListener('click', () => {
    if (filterRow) {
      filterRow.classList.toggle('collapsed');
      const isCollapsed = filterRow.classList.contains('collapsed');
      if (toggleArrow) {
        toggleArrow.innerText = isCollapsed ? '▸' : '▾';
      }
    }
  });

  // Botão FAB Recentralizar Santarém / UFOPA / Caçador
  document.getElementById('btn-recentralizar')?.addEventListener('click', () => {
    if (hunterPosition && selectedSonda) {
      const bounds = L.latLngBounds([
        [hunterPosition.lat, hunterPosition.lon],
        [selectedSonda.latitude, selectedSonda.longitude]
      ]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    } else if (hunterPosition) {
      map.setView([hunterPosition.lat, hunterPosition.lon], 15, { animate: true });
    } else if (selectedSonda) {
      map.setView([selectedSonda.latitude, selectedSonda.longitude], 14, { animate: true });
    } else {
      map.setView([-2.445, -54.725], 11, { animate: true });
    }
  });

  // Botão FAB GPS Caçador
  document.getElementById('btn-hunter-gps')?.addEventListener('click', toggleHunterGPS);

  // Copiar coordenadas
  document.getElementById('btn-copiar-coords')?.addEventListener('click', () => {
    if (!selectedSonda) return;
    const txt = `${selectedSonda.latitude}, ${selectedSonda.longitude}`;
    navigator.clipboard.writeText(txt).then(() => {
      alert(`Coordenadas copiadas: ${txt}`);
    });
  });

  // Toque na alça da gaveta fecha a gaveta
  document.querySelector('.drawer-handle-bar')?.addEventListener('click', () => {
    fecharGaveta();
  });

  // Modal Offline
  const modalOffline = document.getElementById('modal-offline');
  document.getElementById('btn-abrir-offline')?.addEventListener('click', async () => {
    modalOffline.classList.add('open');
    const salvos = await OfflineManager.contarBlocosSalvos();
    document.getElementById('offline-stats').innerText = `${salvos} blocos de mapa salvos no aparelho.`;
  });

  document.getElementById('btn-fechar-offline')?.addEventListener('click', () => {
    modalOffline.classList.remove('open');
  });

  document.getElementById('btn-baixar-offline')?.addEventListener('click', async () => {
    const progressoEl = document.getElementById('offline-progress-bar');
    const statusEl = document.getElementById('offline-progress-text');
    const btn = document.getElementById('btn-baixar-offline');
    const selectTipo = document.getElementById('select-offline-map-type');
    const tipo = selectTipo ? selectTipo.value : 'ruas';

    btn.disabled = true;
    btn.innerText = 'Baixando...';

    await OfflineManager.baixarAreaOffline(10, 13, null, (baixados, total, erros) => {
      const pct = Math.round((baixados / total) * 100);
      progressoEl.style.width = `${pct}%`;
      statusEl.innerText = `${baixados} de ${total} blocos (${pct}%) baixados.`;
    }, tipo);

    btn.disabled = false;
    btn.innerText = 'Concluído!';
    const salvos = await OfflineManager.contarBlocosSalvos();
    document.getElementById('offline-stats').innerText = `Total: ${salvos} blocos salvos no aparelho.`;
  });

  // Modal Seletor de Camadas (Satélite / Relevo / Ruas)
  const modalCamadas = document.getElementById('modal-camadas');
  document.getElementById('btn-mudar-camada')?.addEventListener('click', () => {
    modalCamadas?.classList.add('open');
  });
  document.getElementById('btn-fechar-camadas')?.addEventListener('click', () => {
    modalCamadas?.classList.remove('open');
  });
  modalCamadas?.addEventListener('click', (e) => {
    if (e.target === modalCamadas) modalCamadas.classList.remove('open');
  });

  document.querySelectorAll('.layer-option-card').forEach(card => {
    card.addEventListener('click', () => {
      const layerKey = card.getAttribute('data-layer');
      if (layerKey) {
        mudarEstiloMapa(layerKey);
        setTimeout(() => modalCamadas?.classList.remove('open'), 200);
      }
    });
  });

  // Detecção Robusta de App Nativo Instalado (Capacitor / Android WebView)
  const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
                      window.location.protocol === 'capacitor:' ||
                      window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1' ||
                      navigator.userAgent.includes('wv') ||
                      window.location.origin.includes('localhost');

  // Se já estiver dentro do aplicativo instalado, marca a classe no body e oculta botões de download
  if (isNativeApp) {
    document.body.classList.add('is-native-app');
    const btnApk = document.getElementById('btn-abrir-apk');
    if (btnApk) btnApk.style.display = 'none';
    const mobileBanner = document.getElementById('mobile-apk-banner');
    if (mobileBanner) mobileBanner.style.display = 'none';
  }

  // Modal App APK Android (Apenas para acesso via navegador web)
  const modalApk = document.getElementById('modal-apk');
  document.getElementById('btn-abrir-apk')?.addEventListener('click', () => {
    modalApk?.classList.add('open');
  });
  document.getElementById('btn-fechar-apk')?.addEventListener('click', () => {
    modalApk?.classList.remove('open');
  });
  modalApk?.addEventListener('click', (e) => {
    if (e.target === modalApk) modalApk.classList.remove('open');
  });
  modalOffline?.addEventListener('click', (e) => {
    if (e.target === modalOffline) modalOffline.classList.remove('open');
  });

  // Banner Flutuante para Celular (APENAS se estiver no navegador comum, nunca no app nativo!)
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const mobileBanner = document.getElementById('mobile-apk-banner');
  if (isMobile && !isNativeApp && mobileBanner) {
    setTimeout(() => {
      mobileBanner.style.display = 'flex';
    }, 1500);
    document.getElementById('btn-banner-baixar')?.addEventListener('click', () => {
      modalApk?.classList.add('open');
    });
    document.getElementById('btn-banner-fechar')?.addEventListener('click', () => {
      mobileBanner.style.display = 'none';
    });
  }
}

