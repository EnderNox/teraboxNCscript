// ==UserScript==
// @name         NoxCrack - Terabox Bypass
// @namespace    http://tampermonkey.net/
// @version      2.2.0
// @description  Professional Terabox direct link extractor - Chrome & Firefox compatible
// @match        *://localhost:*/*
// @match        *://*.-site-noxc.com/*
// @match        *://*2.56.246.119:30232/*
// @grant        GM_xmlhttpRequest
// @connect      1024terabox.com
// @connect      1024tera.com
// @connect      terabox.app
// @connect      terabox.com
// @connect      nephobox.com
// @connect      www.terabox.app
// @connect      d.terabox.app
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const APP_ID = "250528";
    const COOKIE  = "lang=en; ndus=YS4sigYteHuiw7UWLc_O1bLkLaVksR5S7O9iRrqM";

    // ================================================================
    // UTILS
    // ================================================================
    function extractBetween(source, start, end) {
        const si = source.indexOf(start);
        if (si === -1) return null;
        const cs = si + start.length;
        const ei = source.indexOf(end, cs);
        if (ei === -1) return null;
        return source.substring(cs, ei);
    }

    function httpRequest(method, url, extraHeaders = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method, url,
                headers: {
                    "User-Agent": navigator.userAgent,
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                    "Cookie": COOKIE,
                    ...extraHeaders
                },
                anonymous: true,
                timeout: 15000,
                onload(r) {
                    if (r.status >= 200 && r.status < 400) resolve(r);
                    else reject(new Error(`HTTP ${r.status}`));
                },
                onerror()   { reject(new Error(`NETWORK_ERROR::${url}`)); },
                ontimeout() { reject(new Error(`ETP_TIMEOUT::${url}`)); }
            });
        });
    }

    function normalizeUrl(url) {
        const mirrors = ['1024terabox.com','1024tera.com','nephobox.com','terabox.com'];
        try {
            const p = new URL(url);
            if (mirrors.some(m => p.hostname.includes(m))) {
                p.hostname = 'www.terabox.app';
                return p.toString();
            }
        } catch(e) {}
        return url;
    }

    // ================================================================
    // CORE
    // ================================================================
    async function processTeraboxUrl(targetUrl) {
        const url = normalizeUrl(targetUrl);

        // Étape 1 : Résolution surl
        const r1 = await httpRequest('GET', url);
        const finalUrl = r1.finalUrl || r1.responseURL || url;

        let surl = finalUrl.match(/surl=([^&]+)/)?.[1]
                || r1.responseText?.match(/surl['":\s=]+([A-Za-z0-9_-]{6,})/)?.[1]
                || targetUrl.match(/\/s\/([A-Za-z0-9_-]+)/)?.[1];
        if (!surl) throw new Error('SURL introuvable.');

        // Étape 2 : jsToken avec retry
        const shareUrl = `https://www.terabox.app/sharing/link?surl=${surl}`;
        let html = '';

        for (let attempt = 1; attempt <= 3; attempt++) {
            const r2 = await httpRequest('GET', shareUrl, { Referer: 'https://www.terabox.app/' });
            html = r2.responseText;
            if (html.length > 500) break;
            if (html.includes('errno')) {
                let e;
                try { e = JSON.parse(html); } catch(_) {}
                if (e?.errno === 400141 && attempt < 3) {
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                    continue;
                }
                throw new Error(`API errno ${e?.errno || '?'}: ${e?.errmsg || html}`);
            }
            await new Promise(r => setTimeout(r, 800));
        }

        if (html.length < 500) throw new Error('Page de partage vide après 3 tentatives.');

        let jsToken = extractBetween(html, 'fn%28%22', '%22%29')
                   || html.match(/jsToken\s*=\s*["']([^"']{20,})["']/i)?.[1]
                   || html.match(/"jsToken"\s*:\s*"([^"]{20,})"/)?.[1];

        if (!jsToken) throw new Error('jsToken introuvable.');

        const logid = extractBetween(html, 'dp-logid=', '&')
                   || html.match(/logid["']?\s*[:=]\s*["']?([0-9]+)/i)?.[1]
                   || '229620269171703614';

        // Étape 3 : API share/list
        const apiUrl = new URL('https://www.terabox.app/share/list');
        for (const [k, v] of Object.entries({
            app_id: APP_ID, web: '1', channel: 'dubox', clienttype: '0',
            jsToken, 'dp-logid': logid, page: '1', num: '20',
            by: 'name', order: 'asc', site_referer: shareUrl, shorturl: surl, root: '1'
        })) apiUrl.searchParams.append(k, v);

        const r3 = await httpRequest('GET', apiUrl.toString(), { Referer: shareUrl });
        const data = JSON.parse(r3.responseText);

        if (data.errno !== 0) throw new Error(`API errno ${data.errno} — ${data.errmsg}`);
        if (!data.list?.length) throw new Error('Liste vide — fichier supprimé ou lien invalide.');

        const file = data.list[0];
        if (!file.dlink) throw new Error('dlink absent.');

        // Étape 4 : Résolution CDN
        let finalDl = file.dlink;
        try {
            const r4 = await httpRequest('HEAD', file.dlink, { Referer: shareUrl });
            finalDl = r4.finalUrl || r4.responseURL || file.dlink;
        } catch(_) {
            try {
                const r4b = await httpRequest('GET', file.dlink, { Referer: shareUrl });
                finalDl = r4b.finalUrl || r4b.responseURL || file.dlink;
            } catch(_) {}
        }

        return { url: finalDl, filename: file.server_filename, size: file.size, md5: file.md5 };
    }

    // ================================================================
    // BRIDGE
    // ================================================================
    function initializeBridge() {
        // Signal immédiat au chargement + répétition toutes les secondes
        window.dispatchEvent(new CustomEvent('noxcrack-ready'));
        setInterval(() => window.dispatchEvent(new CustomEvent('noxcrack-ready')), 1000);

        window.addEventListener('noxcrack-start-download', async (event) => {
            if (!event.detail?.url) return;
            try {
                const result = await processTeraboxUrl(event.detail.url);
                window.dispatchEvent(new CustomEvent('noxcrack-link-ready', {
                    detail: {
                        directUrl: result.url,
                        filename:  result.filename,
                        size:      result.size,
                        md5:       result.md5
                    }
                }));
            } catch (error) {
                window.dispatchEvent(new CustomEvent('noxcrack-error', {
                    detail: {
                        message:    error.message,
                        isEtpBlock: error.message.startsWith('ETP_TIMEOUT') || error.message.startsWith('NETWORK_ERROR')
                    }
                }));
            }
        });
    }

    initializeBridge();
})();
