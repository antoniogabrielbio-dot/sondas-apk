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

    // 1. Tenta carregar do armazenamento permanente IndexedDB (TileDB)
    if (window.TileDB) {
      TileDB.obterTile(key).then(cachedData => {
        if (cachedData) {
          tile.src = cachedData;
          done(null, tile);
          return;
        }

        // 2. Não está em cache
        if (navigator.onLine) {
          this.carregarOnlineESalvar(coords, key, tile, done);
        } else {
          // 3. 100% OFFLINE: Interpola o bloco do zoom anterior para NUNCA ficar preto!
          this.recuperarDoBlocoPai(tipo, coords, tile, done);
        }
      }).catch(() => {
        if (navigator.onLine) {
          this.carregarOnlineESalvar(coords, key, tile, done);
        } else {
          this.recuperarDoBlocoPai(tipo, coords, tile, done);
        }
      });
    } else {
      tile.src = this.getTileUrl(coords);
      tile.onload = () => done(null, tile);
      tile.onerror = () => done(null, tile);
    }

    return tile;
  },

  carregarOnlineESalvar(coords, key, tile, done) {
    const url = this.getTileUrl(coords);
    tile.crossOrigin = 'Anonymous';
    tile.onload = () => {
      done(null, tile);
      // Salva silenciosamente no IndexedDB para uso offline no campo
      if (window.TileDB) {
        TileDB.salvarTileDaImg(key, tile);
      }
    };
    tile.onerror = () => {
      // Se falhar a conexão, interpola do bloco pai imediatamente
      this.recuperarDoBlocoPai(this.options.tipo || 'satelite', coords, tile, done);
    };
    tile.src = url;
  },

  recuperarDoBlocoPai(tipo, coords, tile, done) {
    if (window.TileDB) {
      TileDB.buscarBlocoPai(tipo, coords).then(canvasData => {
        if (canvasData) {
          tile.src = canvasData;
          done(null, tile);
        } else {
          // Fundo suave de floresta/relevo em vez de tela preta
          tile.style.backgroundColor = (tipo.includes('satelite')) ? '#132a13' : '#1e293b';
          done(null, tile);
        }
      });
    } else {
      done(null, tile);
    }
  }
});

function criarCamadasMapas() {
  const opcoesBlindadas = {
    maxNativeZoom: 16,
    maxZoom: 22,
    keepBuffer: 100,
    updateWhenZooming: false,
    updateWhenIdle: true
  };

  camadasDisponiveis = {
    // 1. Google Satélite Híbrido (com nomes de estradas, rios e ramais)
    satelite: new LocalOfflineTileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      tipo: 'satelite',
      ...opcoesBlindadas
    }),
    // 2. Google Relevo / Topografia (curvas de nível e relevo sombreado 3D da mata)
    relevo: new LocalOfflineTileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      tipo: 'relevo',
      ...opcoesBlindadas
    }),
    // 3. OpenStreetMap (Ruas, cidades e vicinais)
    ruas: new LocalOfflineTileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      tipo: 'ruas',
      ...opcoesBlindadas
    }),
    // 4. Google Satélite Puro (sem rótulos para ver copas das árvores e clareiras)
    satelite_puro: new LocalOfflineTileLayer('https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      tipo: 'satelite_puro',
      ...opcoesBlindadas
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

  // Atualiza o texto do botão do cabeçalho
  const btn = document.getElementById('btn-mudar-camada');
  if (btn) {
    if (chave === 'satelite') btn.innerHTML = '🛰️ Satélite';
    else if (chave === 'relevo') btn.innerHTML = '🏔️ Relevo';
    else if (chave === 'ruas') btn.innerHTML = '🗺️ Ruas';
    else if (chave === 'satelite_puro') btn.innerHTML = '📷 Sat. Puro';
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

  L.control.zoom({ position: 'bottomright' }).addTo(map);

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
// 7. MODO CAÇADA - GPS DO CAÇADOR EM TEMPO REAL
// =========================================================
function toggleHunterGPS() {
  const btn = document.getElementById('btn-hunter-gps');

  if (hunterWatchId !== null) {
    // Desliga GPS
    navigator.geolocation.clearWatch(hunterWatchId);
    hunterWatchId = null;
    if (hunterMarker) map.removeLayer(hunterMarker);
    if (hunterAccuracyCircle) map.removeLayer(hunterAccuracyCircle);
    if (huntTrackingLine) map.removeLayer(huntTrackingLine);
    hunterMarker = null;
    hunterAccuracyCircle = null;
    huntTrackingLine = null;
    document.getElementById('hunter-hud').style.display = 'none';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    btn.innerText = '🧭 Minha Posição';
    return;
  }

  if (!('geolocation' in navigator)) {
    alert('Geolocalização não suportada neste dispositivo.');
    return;
  }

  btn.classList.remove('btn-secondary');
  btn.classList.add('btn-primary');
  btn.innerText = '🛰️ GPS Ativo';

  hunterWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      hunterPosition = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };

      const latlng = [hunterPosition.lat, hunterPosition.lon];

      if (!hunterMarker) {
        const icon = L.divIcon({
          className: 'hunter-pulsing-icon',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        });
        hunterMarker = L.marker(latlng, { icon: icon }).addTo(map);
        hunterAccuracyCircle = L.circle(latlng, {
          radius: pos.coords.accuracy,
          color: '#38bdf8',
          fillColor: '#38bdf8',
          fillOpacity: 0.15,
          weight: 1
        }).addTo(map);

        map.setView(latlng, 14);
      } else {
        hunterMarker.setLatLng(latlng);
        hunterAccuracyCircle.setLatLng(latlng);
        hunterAccuracyCircle.setRadius(pos.coords.accuracy);
      }

      atualizarHudCacada();
    },
    (err) => {
      console.warn('Erro ao obter GPS:', err);
      alert('Não foi possível obter a posição GPS. Verifique a permissão no navegador.');
      toggleHunterGPS();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
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

  document.getElementById('hud-rumo').innerText = `Rumo: ${res.azimuteGraus}° (${res.pontoCardinal})`;
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
  const badges = document.querySelectorAll('.filter-badges .badge');

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

  // Busca rápida de código
  const searchInput = document.getElementById('search-input');
  searchInput?.addEventListener('input', () => {
    renderizarMarcadores();
  });

  document.getElementById('btn-clear-search')?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
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

  // Botão GPS Caçador
  document.getElementById('btn-hunter-gps')?.addEventListener('click', toggleHunterGPS);

  // Copiar coordenadas
  document.getElementById('btn-copiar-coords')?.addEventListener('click', () => {
    if (!selectedSonda) return;
    const txt = `${selectedSonda.latitude}, ${selectedSonda.longitude}`;
    navigator.clipboard.writeText(txt).then(() => {
      alert(`Coordenadas copiadas: ${txt}`);
    });
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

  // Detecção de App Nativo Instalado (Capacitor / Android)
  const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform()) ||
                      window.location.protocol === 'capacitor:' ||
                      window.location.hostname === 'localhost';

  // Se já estiver dentro do aplicativo instalado, oculta o botão e banner de download
  if (isNativeApp) {
    const btnApk = document.getElementById('btn-abrir-apk');
    if (btnApk) btnApk.style.display = 'none';
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

