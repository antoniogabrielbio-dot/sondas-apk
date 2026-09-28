/**
 * Módulo de Trajetória e Predição de Queda (Landing Prediction) - Versão Visual Avançada
 * - Rastro luminoso em camadas com efeito de brilho (glow) e gradiente por altitude.
 * - Efeito sonar/radar pulsante no ponto previsto de impacto.
 * - Marcador de último contato com paraquedas e badge de altitude.
 * - Painel HUD flutuante tático com rota direta.
 */

const TrajetoriaEngine = {
  ALTITUDE_SOLO_PADRAO: 40,
  activeLayers: [],
  hudElement: null,

  /**
   * Limpa camadas de trajetória do mapa e remove o HUD flutuante
   */
  limparTrajetoria(map) {
    if (this.activeLayers && this.activeLayers.length > 0) {
      this.activeLayers.forEach(layer => map.removeLayer(layer));
      this.activeLayers = [];
    }
    const hud = document.getElementById('trajectory-hud');
    if (hud) hud.style.display = 'none';
  },

  /**
   * Calcula o ponto projetado de impacto no solo baseado no último pacote de telemetria
   */
  calcularPontoQueda(sonda, altitudeSolo = this.ALTITUDE_SOLO_PADRAO) {
    const lat0 = Number(sonda.latitude);
    const lon0 = Number(sonda.longitude);
    const alt0 = Number(sonda.altitude || 0);
    const vz = Math.abs(Number(sonda.velocidade_vertical || 4.5));
    const vh = Number(sonda.velocidade_horizontal || 0);
    const direcao = Number(sonda.direcao || 0);

    if (alt0 <= altitudeSolo) {
      return {
        latQueda: lat0,
        lonQueda: lon0,
        tempoRestanteSeg: 0,
        distanciaArrastoM: 0,
        raioIncertezaM: 25,
        jaEmSolo: true,
        alt0,
        vz,
        vh,
        direcao
      };
    }

    const deltaAlt = alt0 - altitudeSolo;
    const tempoQueda = deltaAlt / (vz > 0.5 ? vz : 4.5);
    const distArrasto = vh * tempoQueda;

    const rad = direcao * (Math.PI / 180);
    const dNorte = distArrasto * Math.cos(rad);
    const dLeste = distArrasto * Math.sin(rad);

    const deltaLat = dNorte / 111320;
    const deltaLon = dLeste / (111320 * Math.cos(lat0 * Math.PI / 180));

    const latQueda = lat0 + deltaLat;
    const lonQueda = lon0 + deltaLon;
    const raioIncerteza = Math.max(45, Math.round(distArrasto * 0.22 + deltaAlt * 0.08));

    return {
      latQueda: Number(latQueda.toFixed(5)),
      lonQueda: Number(lonQueda.toFixed(5)),
      tempoRestanteSeg: Math.round(tempoQueda),
      distanciaArrastoM: Math.round(distArrasto),
      raioIncertezaM: raioIncerteza,
      jaEmSolo: false,
      deltaAlt: Math.round(deltaAlt),
      alt0,
      vz,
      vh,
      direcao
    };
  },

  /**
   * Renderiza a predição de queda com visualização luminosa tática
   */
  plotarPredicao(map, sonda, predicao) {
    this.limparTrajetoria(map);

    const pUltimo = [sonda.latitude, sonda.longitude];
    const pQueda = [predicao.latQueda, predicao.lonQueda];

    // 1. LINHA DE DESCIDA LUMINOSA (3 CAMADAS: Glow externo + Linha Neon + Pulso interno)
    if (!predicao.jaEmSolo && predicao.distanciaArrastoM > 10) {
      // Camada 1: Brilho Difuso (Glow)
      const glowLine = L.polyline([pUltimo, pQueda], {
        color: '#f97316',
        weight: 12,
        opacity: 0.28,
        lineCap: 'round'
      }).addTo(map);
      this.activeLayers.push(glowLine);

      // Camada 2: Linha de Energia Neon
      const coreLine = L.polyline([pUltimo, pQueda], {
        color: '#fb923c',
        weight: 5,
        opacity: 0.9,
        lineCap: 'round'
      }).addTo(map);
      this.activeLayers.push(coreLine);

      // Camada 3: Linha de Fluxo Animada / Tracejada
      const pulseLine = L.polyline([pUltimo, pQueda], {
        color: '#ffffff',
        weight: 2,
        dashArray: '6, 10',
        opacity: 0.95
      }).addTo(map);
      this.activeLayers.push(pulseLine);

      pulseLine.bindTooltip(`
        <div style="font-family:sans-serif; font-size:12px; font-weight:600;">
          💨 Arrasto de Vento: ${predicao.distanciaArrastoM}m<br>
          ⏱️ Tempo estimado: ${predicao.tempoRestanteSeg}s (${Math.round(predicao.tempoRestanteSeg/60)} min)
        </div>
      `, { sticky: true });
    }

    // 2. CÍRCULO DO RAIO DE BUSCA (Área de Incerteza)
    const circuloBusca = L.circle(pQueda, {
      radius: predicao.raioIncertezaM,
      color: '#f43f5e',
      fillColor: '#f43f5e',
      fillOpacity: 0.18,
      weight: 1.5,
      dashArray: '4, 4'
    }).addTo(map);
    this.activeLayers.push(circuloBusca);

    // 3. RADAR / SONAR PULSANTE NO PONTO DE IMPACTO
    const radarIcon = L.divIcon({
      className: 'radar-marker-container',
      html: `
        <div class="radar-ping">
          <div class="radar-wave"></div>
          <div class="radar-wave wave-2"></div>
          <div class="radar-center">🎯</div>
          <div class="radar-label">IMPACTO PREVISTO</div>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const marcadorImpacto = L.marker(pQueda, { icon: radarIcon }).addTo(map);
    this.activeLayers.push(marcadorImpacto);

    // 4. MARCADOR DE ÚLTIMO CONTATO DA SONDA (Com ícone de paraquedas e tag de altitude)
    const lastContactIcon = L.divIcon({
      className: 'last-contact-container',
      html: `
        <div class="last-contact-pin">
          <span class="icon">🪂</span>
          <span class="alt-tag">${Math.round(sonda.altitude || 0)}m</span>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 36]
    });

    const marcadorUltimo = L.marker(pUltimo, { icon: lastContactIcon }).addTo(map);
    marcadorUltimo.bindTooltip(`<b>Último Sinal RS41</b><br>Alt: ${sonda.altitude}m | V: ${sonda.velocidade_vertical} m/s`, {
      direction: 'top',
      offset: [0, -32]
    });
    this.activeLayers.push(marcadorUltimo);

    // 5. EXIBE O HUD FLUTUANTE DA TRAJETÓRIA
    this.exibirHUDTrajetoria(map, sonda, predicao);

    // Ajusta o mapa com animação suave e margem generosa
    const group = L.featureGroup(this.activeLayers);
    map.flyToBounds(group.getBounds().pad(0.35), {
      duration: 1.2,
      easeLinearity: 0.25
    });
  },

  /**
   * Plota rastro de telemetria completa com gradiente de altitude neon
   */
  plotarRastroTelemetria(map, pontos) {
    if (!pontos || pontos.length < 2) return;

    const alts = pontos.map(p => p.altitude || 0);
    const minAlt = Math.min(...alts);
    const maxAlt = Math.max(...alts);

    for (let i = 0; i < pontos.length - 1; i++) {
      const p1 = pontos[i];
      const p2 = pontos[i + 1];

      // Gradiente atmosférico vibrante:
      // Violeta (>12km) -> Ciano (5-12km) -> Verde (2-5km) -> Amarelo (1-2km) -> Vermelho/Coral (<500m)
      const ratio = maxAlt > minAlt ? (p1.altitude - minAlt) / (maxAlt - minAlt) : 0;
      let color;
      if (ratio > 0.75) color = '#a855f7'; // Roxo neon
      else if (ratio > 0.5) color = '#06b6d4'; // Ciano elétrico
      else if (ratio > 0.25) color = '#10b981'; // Esmeralda
      else if (ratio > 0.1) color = '#f59e0b'; // Âmbar
      else color = '#ef4444'; // Vermelho solo

      // Glow suave de fundo
      const glowSeg = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
        color: color,
        weight: 7,
        opacity: 0.35,
        lineCap: 'round'
      }).addTo(map);
      this.activeLayers.push(glowSeg);

      // Linha nítida principal
      const seg = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], {
        color: color,
        weight: 3.5,
        opacity: 0.95,
        lineCap: 'round'
      }).addTo(map);

      seg.bindTooltip(`Alt: ${Math.round(p1.altitude)}m | Vel: ${p1.vh || 0} m/s`, { sticky: true });
      this.activeLayers.push(seg);
    }
  },

  /**
   * Exibe painel HUD flutuante moderno para a trajetória
   */
  exibirHUDTrajetoria(map, sonda, predicao) {
    let hud = document.getElementById('trajectory-hud');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'trajectory-hud';
      hud.className = 'trajectory-hud-card';
      document.getElementById('app-container').appendChild(hud);
    }

    const tempoFormatado = predicao.tempoRestanteSeg > 60 
      ? `${Math.floor(predicao.tempoRestanteSeg / 60)}m ${predicao.tempoRestanteSeg % 60}s`
      : `${predicao.tempoRestanteSeg}s`;

    hud.innerHTML = `
      <div class="traj-hud-header">
        <div class="traj-hud-title">
          <span class="pulse-dot"></span>
          <span>Trajetória: <b>${sonda.codigo}</b></span>
        </div>
        <button class="btn-close-traj" onclick="TrajetoriaEngine.limparTrajetoria(map)">✕</button>
      </div>

      <div class="traj-hud-metrics">
        <div class="metric-pill">
          <span class="label">Último Sinal</span>
          <span class="val">${Math.round(predicao.alt0)} m</span>
        </div>
        <div class="metric-pill">
          <span class="label">Taxa Descida</span>
          <span class="val">${predicao.vz} m/s</span>
        </div>
        <div class="metric-pill">
          <span class="label">Desvio Vento</span>
          <span class="val">${predicao.distanciaArrastoM} m</span>
        </div>
        <div class="metric-pill">
          <span class="label">Tempo Restante</span>
          <span class="val">${tempoFormatado}</span>
        </div>
        <div class="metric-pill highlight">
          <span class="label">Raio de Busca</span>
          <span class="val">±${predicao.raioIncertezaM} m</span>
        </div>
      </div>

      <div class="traj-hud-actions">
        <a class="btn btn-primary btn-sm" target="_blank"
           href="https://www.google.com/maps/dir/?api=1&destination=${predicao.latQueda},${predicao.lonQueda}">
          📍 Rota Google Maps
        </a>
        <a class="btn btn-success btn-sm"
           href="geo:${predicao.latQueda},${predicao.lonQueda}?q=${predicao.latQueda},${predicao.lonQueda}(Impacto_${sonda.codigo})">
          🧭 GPS Offline
        </a>
      </div>
    `;

    hud.style.display = 'flex';
  }
};

window.TrajetoriaEngine = TrajetoriaEngine;
