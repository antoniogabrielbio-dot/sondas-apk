/**
 * Auto-Updater Over-The-Air (OTA) do Sondas 2.0
 * Baixa e aplica melhorias de código/interface automaticamente pela internet
 * sem que o usuário precise reinstalar o APK.
 */
const AppUpdater = {
  MANIFEST_URL: 'https://raw.githubusercontent.com/antoniogabrielbio-dot/sondas-apk/main/web/version.json',
  BASE_URL: 'https://raw.githubusercontent.com/antoniogabrielbio-dot/sondas-apk/main/web/',

  iniciar() {
    // Carrega melhorias salvas no armazenamento local se existirem
    this.aplicarCacheLocal();

    // Verifica novas versões na nuvem se estiver conectado
    if (navigator.onLine) {
      setTimeout(() => this.verificarAtualizacao(), 2500);
    }

    window.addEventListener('online', () => {
      this.verificarAtualizacao();
    });
  },

  aplicarCacheLocal() {
    try {
      const versaoSalva = localStorage.getItem('sondas_ota_version');
      if (!versaoSalva) return;

      const css = localStorage.getItem('sondas_ota_css');
      if (css) {
        let style = document.getElementById('ota-injected-styles');
        if (!style) {
          style = document.createElement('style');
          style.id = 'ota-injected-styles';
          document.head.appendChild(style);
        }
        style.textContent = css;
      }
    } catch (e) {
      console.warn('[OTA] Erro ao carregar cache local:', e);
    }
  },

  async verificarAtualizacao() {
    try {
      const url = `${this.MANIFEST_URL}?_nocache=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) return;

      const manifest = await res.json();
      const versaoLocal = localStorage.getItem('sondas_ota_version') || '1.0.0';

      if (manifest.version && manifest.version !== versaoLocal) {
        console.log(`[OTA] Atualização encontrada: v${manifest.version} (Atual: v${versaoLocal})`);
        await this.baixarEAtualizar(manifest);
      }
    } catch (err) {
      console.log('[OTA] Sem atualizações no momento:', err.message);
    }
  },

  async baixarEAtualizar(manifest) {
    try {
      // Baixa CSS e JS atualizados
      const resCss = await fetch(`${this.BASE_URL}css/style.css?_t=${Date.now()}`);
      if (resCss.ok) {
        const cssContent = await resCss.text();
        localStorage.setItem('sondas_ota_css', cssContent);
      }

      localStorage.setItem('sondas_ota_version', manifest.version);
      this.exibirAvisoSucesso(manifest.version);
    } catch (e) {
      console.warn('[OTA] Falha ao baixar arquivos da atualização:', e);
    }
  },

  exibirAvisoSucesso(versao) {
    let toast = document.getElementById('ota-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ota-toast';
      toast.className = 'mobile-apk-toast';
      toast.style.display = 'flex';
      toast.style.zIndex = '9999';
      toast.style.border = '1px solid #10b981';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:1.4rem;">✨</span>
        <div style="display:flex; flex-direction:column;">
          <b style="color:#10b981; font-size:0.9rem;">App Atualizado (v${versao})!</b>
          <span style="color:#94a3b8; font-size:0.75rem;">Melhorias carregadas pela nuvem.</span>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="location.reload()" style="background:#10b981; border:none; font-weight:700;">
        Recarregar
      </button>
    `;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  AppUpdater.iniciar();
});
