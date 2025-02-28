/**
 * HyperMonitor - Extension de surveillance de sites web
 * Version: 1.0.0
 * 
 * Organisation du code :
 * 1. Configuration
 * 2. Classes utilitaires
 * 3. Gestionnaires principaux
 * 4. Interface utilisateur
 * 5. Initialisation
 */

//=============================================================================
// 1. CONFIGURATION
//=============================================================================

const CONFIG = {
    // Intervalles de temps
    REFRESH_INTERVAL: 30000,
    CACHE_DURATION: 30000,
    MEMORY_CACHE_DURATION: 30000,
    FETCH_TIMEOUT: 5000,
    
    // Limites et seuils
    MAX_HISTORY_ENTRIES: 100,
    HISTORY_DURATION: 24 * 60 * 60 * 1000,
    COMPRESSION_THRESHOLD: 1024,
    
    // Sites et protections
    MAJOR_SITES: [
        'google.', 'facebook.', 'microsoft.', 'apple.', 'amazon.', 'youtube.', 
        'twitter.', 'instagram.', 'cloudflare.', 'github.', 'gitlab.', 'netlify.',
        'vercel.', 'heroku.', 'wordpress.', 'shopify.', 'wix.'
    ],
    PROTECTION_SIGNS: [
        'cloudflare', 'nginx', 'apache', 'varnish', 'akamai', 'fastly',
        'cdn', 'sucuri', 'incapsula', 'aws', 'azure', 'gcp'
    ],
    
    // Codes HTTP
    HTTP_SUCCESS_MIN: 200,
    HTTP_SUCCESS_MAX: 399,
    HTTP_ERROR_MIN: 400
};

//=============================================================================
// 2. CLASSES UTILITAIRES
//=============================================================================

class Utils {
    static formatDate(timestamp) {
        return new Date(timestamp).toLocaleString('fr-FR', {
            dateStyle: 'short',
            timeStyle: 'medium'
        });
    }

    static isValidUrl(url) {
        try {
            new URL(url.startsWith('http') ? url : `http://${url}`);
            return true;
        } catch {
            return false;
        }
    }

    static sanitizeUrl(url) {
        return url.trim().toLowerCase().replace(/^https?:\/\//, '');
    }
}

//=============================================================================
// 3. GESTIONNAIRES PRINCIPAUX
//=============================================================================

class CacheManager {
    static SITES_DATA_KEY = 'sites_data';
    static memoryCache = new Map();
    static memoryCacheTimestamps = new Map();

    // Méthodes principales
    static async get(url) {
        try {
            console.log(`[CACHE] Tentative de récupération pour ${url}`);
            const memoryEntry = this.memoryCache.get(url);
            const memoryTimestamp = this.memoryCacheTimestamps.get(url);
            
            if (memoryEntry && memoryTimestamp) {
                const age = Date.now() - memoryTimestamp;
                console.log(`[CACHE] Cache mémoire trouvé pour ${url}, âge: ${age}ms`);
                
                if (age < CONFIG.MEMORY_CACHE_DURATION) {
                    console.log(`[CACHE] ✅ Utilisation du cache mémoire pour ${url}`);
                    return memoryEntry;
                } else {
                    console.log(`[CACHE] Cache mémoire expiré pour ${url}`);
                }
            }

            console.log(`[CACHE] Vérification du cache stockage pour ${url}`);
            const result = await chrome.storage.local.get(this.SITES_DATA_KEY);
            const cache = result[this.SITES_DATA_KEY] || {};
            const entry = cache[url];
            
            if (entry) {
                console.log(`[CACHE] Entrée trouvée pour ${url}:`, entry);
                if (this.isValid(entry)) {
                    console.log(`[CACHE] ✅ Cache stockage valide pour ${url}`);
                    this.memoryCache.set(url, entry.data);
                    this.memoryCacheTimestamps.set(url, Date.now());
                    return entry.data;
                } else {
                    console.log(`[CACHE] Cache stockage expiré pour ${url}`);
                }
            }

            console.log(`[CACHE] ❌ Aucun cache valide pour ${url}`);
            return null;
        } catch (error) {
            console.error(`[CACHE] ❌ Erreur d'accès au cache pour ${url}:`, error);
            return null;
        }
    }

    static async set(url, data) {
        try {
            console.log(`[CACHE] Mise en cache pour ${url}:`, data);
            const cache = await this.getSitesData();
            const entry = {
                data: {
                    ...data,
                    avgResponse: data.online ? data.avgResponse : null
                },
                timestamp: Date.now(),
                expiresAt: Date.now() + CONFIG.CACHE_DURATION
            };

            console.log(`[CACHE] Nouvelle entrée pour ${url}:`, entry);
            this.memoryCache.set(url, entry.data);
            this.memoryCacheTimestamps.set(url, Date.now());
            cache[url] = entry;
            await this.saveSitesData(cache);
            console.log(`[CACHE] ✅ Cache mis à jour pour ${url}`);

        } catch (error) {
            console.error(`[CACHE] ❌ Erreur de mise en cache pour ${url}:`, error);
        }
    }

    // Méthodes utilitaires
    static async getSitesData() {
        const result = await chrome.storage.local.get(this.SITES_DATA_KEY);
        return result[this.SITES_DATA_KEY] || {};
    }

    static async saveSitesData(data) {
        await chrome.storage.local.set({ [this.SITES_DATA_KEY]: data });
    }

    static async clear(url) {
        const sitesData = await this.getSitesData();
        delete sitesData[url];
        await this.saveSitesData(sitesData);
        
        // Nettoyer aussi le cache mémoire
        this.memoryCache.delete(url);
        this.memoryCacheTimestamps.delete(url);
    }

    static async clearAll() {
        await chrome.storage.local.set({ [this.SITES_DATA_KEY]: {} });
        this.memoryCache.clear();
        this.memoryCacheTimestamps.clear();
    }

    static isValid(entry) {
        if (!entry || !entry.timestamp || !entry.expiresAt) {
            console.log('[CACHE] Entrée invalide:', entry);
            return false;
        }
        
        const now = Date.now();
        const timeUntilExpiry = entry.expiresAt - now;
        console.log(`[CACHE] Temps restant avant expiration: ${timeUntilExpiry}ms`);
        
        return timeUntilExpiry > 0;
    }

    static async cleanup() {
        try {
            console.log('[CACHE] Début du nettoyage du cache');
            const sitesData = await this.getSitesData();
            let sitesToRefresh = [];

            for (const [url, entry] of Object.entries(sitesData)) {
                const timeUntilExpiry = entry.expiresAt - Date.now();
                console.log(`[CACHE] ${url}: expire dans ${timeUntilExpiry}ms`);
                
                if (!entry || !entry.expiresAt || timeUntilExpiry < 5000) {
                    console.log(`[CACHE] 🔄 ${url} nécessite un rafraîchissement`);
                    sitesToRefresh.push(url);
                }
            }

            if (sitesToRefresh.length > 0) {
                console.log(`[CACHE] 🔄 ${sitesToRefresh.length} sites à rafraîchir:`, sitesToRefresh);
                const event = new CustomEvent('cachesExpiring', { 
                    detail: { sites: sitesToRefresh } 
                });
                window.dispatchEvent(event);
            } else {
                console.log('[CACHE] ✅ Aucun site à rafraîchir');
            }
        } catch (error) {
            console.error('[CACHE] ❌ Erreur lors du nettoyage:', error);
        }
    }
}

class SiteManager {
    static async getAll() {
        const result = await CacheManager.getSitesData();
        return Object.keys(result);
    }

    static async add(url) {
        const sanitizedUrl = Utils.sanitizeUrl(url);
        if (!Utils.isValidUrl(sanitizedUrl)) {
            throw new Error('URL invalide');
        }

        const sitesData = await CacheManager.getSitesData();
        if (sitesData[sanitizedUrl]) {
            throw new Error('Site déjà existant');
        }

        // Initialiser avec une structure valide
        sitesData[sanitizedUrl] = {
            data: {
                online: null,
                timestamp: Date.now(),
                avgResponse: null,
                headers: null,
                ssl: false,
                protections: {
                    cloudflare: false,
                    akamai: false,
                    varnish: false,
                    nginx: false,
                    apache: false
                }
            },
            timestamp: Date.now(),
            expiresAt: Date.now() + CONFIG.CACHE_DURATION
        };

        await CacheManager.saveSitesData(sitesData);
        return sanitizedUrl;
    }

    static async remove(url) {
        await CacheManager.clear(url);
    }
}

class SiteChecker {
    static async check(url) {
        try {
            // Essayer d'abord HTTPS
            const httpsResult = await this.tryFetch(url, true);
            if (httpsResult.success) {
                return this.createStatus(httpsResult, true);
            }

            // Si HTTPS échoue, essayer HTTP
            const httpResult = await this.tryFetch(url, false);
            if (httpResult.success) {
                return this.createStatus(httpResult, false);
            }

            return this.createOfflineStatus();
        } catch (error) {
            console.error('Erreur de vérification:', error);
            return this.createOfflineStatus();
        }
    }

    static async tryFetch(url, useHttps) {
        const protocol = useHttps ? 'https://' : 'http://';
        const targetUrl = url.startsWith('http') ? url : `${protocol}${url}`;
        
        return new Promise((resolve) => {
            const startTime = performance.now();
            const xhr = new XMLHttpRequest();
            xhr.timeout = CONFIG.FETCH_TIMEOUT;

            xhr.onreadystatechange = () => {
                if (xhr.readyState === 4) {
                    const responseTime = Math.round(performance.now() - startTime);
                    this.handleResponse(xhr, url, targetUrl, responseTime, resolve);
                }
            };

            xhr.onerror = () => this.handleError(xhr, url, startTime, resolve);
            xhr.ontimeout = () => resolve({ success: false, error: 'Timeout' });

            try {
                xhr.open('GET', targetUrl, true);
                xhr.send();
            } catch (error) {
                resolve({ success: false, error: error.message });
            }
        });
    }

    static handleResponse(xhr, url, targetUrl, responseTime, resolve) {
        const headers = this.parseHeaders(xhr);
        const isProtected = this.isProtectedSite(headers);
        const isMajorSite = this.isMajorSite(url);
        const hasCors = this.hasCorsHeaders(headers);

        // Succès standard (200-399)
        if (xhr.status >= CONFIG.HTTP_SUCCESS_MIN && xhr.status < CONFIG.HTTP_SUCCESS_MAX) {
            resolve({
                success: true,
                avgResponse: responseTime,
                headers,
                status: xhr.status,
                cors: hasCors
            });
            return;
        }

        // Erreur HTTP mais site accessible
        if (xhr.status >= CONFIG.HTTP_ERROR_MIN) {
            resolve({
                success: false,
                error: `Erreur HTTP ${xhr.status}`,
                isOffline: true
            });
            return;
        }

        // Site protégé ou majeur avec une réponse
        if ((isProtected || isMajorSite) && xhr.status === 0) {
            resolve({
                success: false,
                error: 'Site inaccessible',
                isOffline: true
            });
            return;
        }

        // Autres cas = site inaccessible
        resolve({
            success: false,
            error: 'Site inaccessible',
            isOffline: true
        });
    }

    static handleError(xhr, url, startTime, resolve) {
        resolve({
            success: false,
            error: 'Site inaccessible',
            isOffline: true
        });
    }

    static isProtectedSite(headers = {}) {
        const serverHeader = headers['server']?.toLowerCase() || '';
        const hasProtection = CONFIG.PROTECTION_SIGNS.some(sign => 
            serverHeader.includes(sign)
        );

        const protectionHeaders = [
            'cf-ray', 'x-cache', 'x-served-by', 'x-cache-hits',
            'x-varnish', 'x-akamai-transformed', 'x-sucuri-id',
            'x-cdn', 'x-fastly-request-id', 'x-amz-cf-id',
            'x-azure-ref', 'x-goog-served-by'
        ];

        return hasProtection || protectionHeaders.some(header => header in headers);
    }

    static isMajorSite(url) {
        return CONFIG.MAJOR_SITES.some(site => url.includes(site));
    }

    static hasCorsHeaders(headers = {}) {
        const corsHeaders = [
            'access-control-allow-origin',
            'access-control-allow-methods',
            'access-control-allow-headers'
        ];
        return corsHeaders.some(header => header in headers);
    }

    static parseHeaders(xhr) {
        const headers = {};
        try {
            xhr.getAllResponseHeaders().split('\r\n').forEach(line => {
                const [key, value] = line.split(': ');
                if (key && value) {
                    headers[key.toLowerCase()] = value;
                }
            });
        } catch (e) {
            console.log('Impossible de lire les en-têtes:', e);
        }
        return headers;
    }

    static createStatus(result, ssl) {
        if (!result.success) {
            return this.createOfflineStatus();
        }

        return {
            online: true,
            avgResponse: result.avgResponse || null,
            headers: result.headers || {},
            ssl,
            statusCode: result.status,
            timestamp: Date.now(),
            protections: this.detectProtections(result.headers || {})
        };
    }

    static createOfflineStatus() {
        return {
            online: false,
            avgResponse: null,
            headers: null,
            ssl: false,
            statusCode: null,
            timestamp: Date.now(),
            protections: {
                cloudflare: false,
                akamai: false,
                varnish: false,
                nginx: false,
                apache: false
            }
        };
    }

    static detectProtections(headers) {
        return {
            cloudflare: !!(headers['cf-ray'] || headers['CF-Ray'] || headers['cf-cache-status']),
            akamai: !!(headers['x-akamai-transformed'] || headers['akamai-origin-hop']),
            varnish: !!(headers['x-varnish'] || headers['x-cache-hits']),
            nginx: headers['server']?.toLowerCase().includes('nginx'),
            apache: headers['server']?.toLowerCase().includes('apache')
        };
    }
}

//=============================================================================
// 4. INTERFACE UTILISATEUR
//=============================================================================

class UI {
    constructor() {
        this.initElements();
        this.bindEvents();
        this.initFooter();
        this.monitor = new SiteMonitor(this);
    }

    initElements() {
        this.elements = {
            form: document.getElementById('addSiteForm'),
            input: document.getElementById('siteInput'),
            list: document.getElementById('sitesList'),
            detail: {
                view: document.getElementById('detailView'),
                back: document.getElementById('backButton'),
                delete: document.getElementById('detailDelete'),
                refresh: document.getElementById('refreshButton'),
                url: document.getElementById('detailUrl'),
                status: document.getElementById('detailStatus'),
                lastCheck: document.getElementById('detailLastCheck'),
                cloudflare: document.getElementById('cloudflareStatus'),
                ssl: document.getElementById('sslStatus'),
                server: document.getElementById('serverResponse'),
                avgResponse: document.getElementById('avgResponseTime')
            },
            footer: {
                version: document.querySelector('.footer-version')
            }
        };

        // Initialiser l'état de la vue détaillée
        this.elements.detail.view.setAttribute('inert', '');
        this.elements.detail.view.setAttribute('aria-expanded', 'false');
    }

    async initFooter() {
        try {
            const manifest = chrome.runtime.getManifest();
            this.elements.footer.version.textContent = `v${manifest.version}`;
        } catch (error) {
            console.error('❌ Erreur lors de la récupération de la version:', error);
            this.elements.footer.version.textContent = 'v?.?.?';
        }
    }

    bindEvents() {
        this.elements.form.addEventListener('submit', e => {
            e.preventDefault();
            this.monitor.addSite(this.elements.input.value);
        });

        this.elements.detail.back.addEventListener('click', () => {
            this.hideDetails();
        });

        this.elements.detail.delete.addEventListener('click', () => {
            this.monitor.deleteSite();
        });

        // Ajout de l'écouteur pour le bouton refresh
        this.elements.detail.refresh.addEventListener('click', () => {
            this.monitor.refreshSite();
        });
    }

    showDetails(url, status, stats) {
        const el = this.elements.detail;
        
        // Mise à jour des informations de base
        el.url.textContent = url;
        el.status.innerHTML = this.createStatusBadge(status.online);
        el.lastCheck.textContent = Utils.formatDate(status.timestamp);
        
        // Mise à jour des badges de protection
        el.cloudflare.className = `protection-badge ${status.protections.cloudflare ? 'cloudflare' : 'none'}`;
        el.cloudflare.textContent = status.protections.cloudflare ? 'Cloudflare' : 'Sans CF';
        
        el.ssl.className = `protection-badge ${status.ssl ? 'ssl' : 'none'}`;
        el.ssl.textContent = status.ssl ? 'SSL' : 'Sans SSL';
        
        // Mise à jour des en-têtes serveur
        if (status.headers && Object.keys(status.headers).length > 0) {
            el.server.textContent = Object.entries(status.headers)
                .map(([key, value]) => `${key}: ${value}`)
                .join('\n');
        } else {
            el.server.textContent = 'Aucune réponse';
        }

        // Mise à jour du temps de réponse moyen
        if (status.online && status.avgResponse) {
            el.avgResponse.textContent = `${status.avgResponse}ms`;
        } else {
            el.avgResponse.textContent = '-';
        }

        // Affichage de la vue détaillée
        el.view.classList.add('active');
        el.view.removeAttribute('inert');
        el.view.setAttribute('aria-expanded', 'true');
    }

    async hideDetails() {
        const view = this.elements.detail.view;
        const currentSite = this.monitor.currentSite;

        // Vérifier si le site est toujours dans la liste
        if (currentSite) {
            const existingItem = this.findSiteItem(currentSite);
            if (!existingItem) {
                // Récupérer le statut actuel du site
                const status = await CacheManager.get(currentSite);
                if (status) {
                    this.addSiteToList(currentSite, status);
                }
            }
        }

        // Retirer le focus des éléments avant de cacher la vue
        const focusedElement = view.querySelector(':focus');
        if (focusedElement) {
            focusedElement.blur();
        }

        view.classList.remove('active');
        view.setAttribute('inert', '');
        view.setAttribute('aria-expanded', 'false');
        this.monitor.currentSite = null;
    }

    createStatusBadge(status) {
        if (status === null) {
            return `
                <span class="status loading">
                    Chargement...
                </span>
            `;
        }
        return `
            <span class="status ${status ? 'online' : 'offline'}">
                ${status ? 'En ligne' : 'Hors ligne'}
            </span>
        `;
    }

    addSiteToList(url, status) {
        const existingItem = this.findSiteItem(url);
        if (existingItem) {
            this.updateSiteItem(existingItem, url, status);
            return;
        }

        const item = document.createElement('div');
        item.className = 'site-item';
        item.setAttribute('role', 'listitem');
        item.setAttribute('data-url', url);
        
        // Ajouter une classe pour l'animation
        item.style.opacity = '0';
        item.style.transform = 'translateY(10px)';
        
        this.updateSiteItem(item, url, status);
        this.elements.list.appendChild(item);

        // Déclencher l'animation après l'ajout
        requestAnimationFrame(() => {
            item.style.transition = 'all 0.3s ease';
            item.style.opacity = '1';
            item.style.transform = 'translateY(0)';
        });
    }

    updateSiteItem(item, url, status) {
        // Ajouter une transition douce pour les mises à jour
        item.style.transition = 'all 0.3s ease';
        
        // Créer l'URL du favicon
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${url}&sz=32`;
        
        item.innerHTML = `
            <div class="site-info">
                <div class="site-header">
                    <img src="${faviconUrl}" 
                         class="site-favicon" 
                         alt="Favicon de ${url}"
                         onerror="this.style.display='none'"
                    >
                    <div class="site-url">${url}</div>
                </div>
                ${this.createStatusBadge(status.online)}
            </div>
        `;
        
        item.onclick = () => this.monitor.showSiteDetails(url);
    }

    findSiteItem(url) {
        return Array.from(this.elements.list.children)
            .find(item => item.getAttribute('data-url') === url);
    }

    clearList() {
        this.elements.list.innerHTML = '';
    }

    clearInput() {
        this.elements.input.value = '';
        this.elements.input.focus();
    }
}

class SiteMonitor {
    constructor(ui) {
        this.ui = ui;
        this.currentSite = null;
        this.refreshInterval = null;
        this.start();

        // Écouter l'expiration du cache
        window.addEventListener('cachesExpiring', async (event) => {
            const sitesToRefresh = event.detail.sites;
            await this.refreshSites(sitesToRefresh);
        });
    }

    async start() {
        await this.loadSites();
        this.startAutoRefresh();
        this.startCacheCleanup();
    }

    startAutoRefresh() {
        // Arrêter l'intervalle existant si présent
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        // Première vérification immédiate
        this.refreshAllSites();

        // Puis toutes les X secondes
        this.refreshInterval = setInterval(() => {
            this.refreshAllSites();
        }, CONFIG.REFRESH_INTERVAL);
    }

    async refreshAllSites() {
        try {
            const sites = await SiteManager.getAll();
            console.log(`🔄 Vérification de ${sites.length} sites`);
            
            await Promise.all(sites.map(async site => {
                // Vérifier si le cache est expiré
                const cache = await CacheManager.getSitesData();
                const entry = cache[site];
                const isExpired = !entry || !entry.expiresAt || Date.now() > entry.expiresAt;

                if (isExpired) {
                    console.log(`🌐 Rafraîchissement de ${site} (cache expiré)`);
                    const status = await SiteChecker.check(site);
                    await CacheManager.set(site, status);
                    
                    const existingItem = this.ui.findSiteItem(site);
                    if (existingItem) {
                        this.ui.updateSiteItem(existingItem, site, status);
                    } else {
                        this.ui.addSiteToList(site, status);
                    }

                    if (this.currentSite === site) {
                        this.ui.showDetails(site, status, status);
                    }
                } else {
                    const cachedStatus = entry.data;
                    console.log(`📦 Utilisation du cache pour ${site}`);
                    
                    const existingItem = this.ui.findSiteItem(site);
                    if (existingItem) {
                        this.ui.updateSiteItem(existingItem, site, cachedStatus);
                    } else {
                        this.ui.addSiteToList(site, cachedStatus);
                    }

                    if (this.currentSite === site) {
                        this.ui.showDetails(site, cachedStatus, cachedStatus);
                    }
                }
            }));

            console.log('✅ Vérification terminée');
        } catch (error) {
            console.error('❌ Erreur lors de la vérification:', error);
        }
    }

    startCacheCleanup() {
        // Vérifier le cache toutes les 30 secondes
        setInterval(() => {
            CacheManager.cleanup();
        }, 30000);
    }

    async addSite(url) {
        try {
            const sanitizedUrl = await SiteManager.add(url);
            this.ui.clearInput();
            
            // Vérifier immédiatement le nouveau site
            const status = await SiteChecker.check(sanitizedUrl);
            await CacheManager.set(sanitizedUrl, status);
            
            const existingItem = this.ui.findSiteItem(sanitizedUrl);
            if (existingItem) {
                this.ui.updateSiteItem(existingItem, sanitizedUrl, status);
            } else {
                this.ui.addSiteToList(sanitizedUrl, status);
            }
            
            console.log('✅ Site ajouté:', sanitizedUrl);
        } catch (error) {
            console.error('❌ Erreur lors de l\'ajout:', error.message);
        }
    }

    async showSiteDetails(url) {
        this.currentSite = url;
        console.log(`🔍 Affichage des détails pour ${url}`);
        
        try {
            const cachedStatus = await CacheManager.get(url);
            if (cachedStatus) {
                console.log(`📦 Utilisation du cache pour les détails de ${url}`);
                this.ui.showDetails(url, cachedStatus, cachedStatus);
                return;
            }

            console.log(`🌐 Vérification en direct pour les détails de ${url}`);
            const status = await SiteChecker.check(url);
            await CacheManager.set(url, status);
            this.ui.showDetails(url, status, status);
            
            const existingItem = this.ui.findSiteItem(url);
            if (existingItem) {
                this.ui.updateSiteItem(existingItem, url, status);
            }
        } catch (error) {
            console.error(`❌ Erreur lors du chargement des détails pour ${url}:`, error);
        }
    }

    async refreshSite() {
        if (!this.currentSite) return;
        
        console.log(`🔄 Rafraîchissement forcé pour ${this.currentSite}`);
        try {
            const status = await SiteChecker.check(this.currentSite);
            await CacheManager.set(this.currentSite, status);
            
            this.ui.showDetails(this.currentSite, status, status);
            
            const existingItem = this.ui.findSiteItem(this.currentSite);
            if (existingItem) {
                this.ui.updateSiteItem(existingItem, this.currentSite, status);
            }
            
            console.log(`✅ Rafraîchissement terminé pour ${this.currentSite}`);
        } catch (error) {
            console.error(`❌ Erreur lors du rafraîchissement de ${this.currentSite}:`, error);
        }
    }

    async deleteSite() {
        if (!this.currentSite) return;

        try {
            await SiteManager.remove(this.currentSite);
            console.log('✅ Site supprimé:', this.currentSite);
            this.ui.hideDetails();
            await this.loadSites();
        } catch (error) {
            console.error('❌ Erreur lors de la suppression:', error);
        }
    }

    async loadSites() {
        try {
            const sites = await SiteManager.getAll();
            
            // Charger d'abord tous les sites avec leur état en cache
            await Promise.all(sites.map(async site => {
                const status = await CacheManager.get(site) || {
                    online: null,
                    timestamp: Date.now(),
                    avgResponse: null,
                    headers: null,
                    ssl: false,
                    protections: {
                        cloudflare: false,
                        akamai: false,
                        varnish: false,
                        nginx: false,
                        apache: false
                    }
                };
                
                this.ui.addSiteToList(site, status);
            }));

            // Puis lancer une vérification immédiate
            this.refreshAllSites();
        } catch (error) {
            console.error('❌ Erreur de chargement:', error);
        }
    }

    async refreshSites(sites) {
        console.log(`🔄 Rafraîchissement forcé pour ${sites.length} sites`);
        
        try {
            await Promise.all(sites.map(async site => {
                const status = await SiteChecker.check(site);
                await CacheManager.set(site, status);
                
                const existingItem = this.ui.findSiteItem(site);
                if (existingItem) {
                    this.ui.updateSiteItem(existingItem, site, status);
                }
                
                if (this.currentSite === site) {
                    this.ui.showDetails(site, status, status);
                }
                
                console.log(`✅ Mise à jour effectuée pour ${site}`);
            }));
        } catch (error) {
            console.error('❌ Erreur lors du rafraîchissement:', error);
        }
    }
}

//=============================================================================
// 5. INITIALISATION
//=============================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Démarrage de l\'application');
    new UI();
}); 