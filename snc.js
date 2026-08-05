(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;
    const SAVE_DELAY = 2000;
    const DEBUG = true;

    // ============== ДЕФОЛТНЫЕ НАСТРОЙКИ ОЧИСТКИ ==============
    const DEFAULT_CLEANUP_CONFIG = {
        enabled: false,
        maxCount: 100,
        percentThreshold: 95,
        daysThreshold: 30,
        autoCleanup: false,
        cleanupInterval: 24 * 60 * 60 * 1000
    };

    // ============== ЛОГГИРОВАНИЕ ==============
    function log() {
        if (DEBUG) {
            console.log.apply(console, ['[TimelineSync]'].concat(Array.from(arguments)));
        }
    }

    function logError() {
        console.error.apply(console, ['[TimelineSync] ERROR:'].concat(Array.from(arguments)));
    }

    // ============== ПОЛУЧЕНИЕ ID ПРОФИЛЯ ==============
    function getProfileId() {
        try {
            const account = Lampa.Storage.get('account', {});
            const profile = account.profile || {};
            return String(profile.id || '');
        } catch(e) {
            return '';
        }
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ КЛЮЧЕЙ ТАЙМЛАЙНОВ ==============
    function getAllTimelineKeys() {
        const keys = ['file_view'];
        const profileId = getProfileId();
        if (profileId) {
            keys.push('file_view_' + profileId);
        }
        
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('nsl_timeline_')) {
                if (!keys.includes(k)) {
                    keys.push(k);
                }
            }
        }
        
        return keys;
    }

    // ============== ОЧИСТКА СТАРЫХ ДАННЫХ ==============
    function cleanupOldData() {
        let cleaned = 0;
        const keysToRemove = [];
        
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && (
                k.startsWith('nsl_timeline_') || 
                k.startsWith('nsl_autobackup_') ||
                k.startsWith('nsl_hash_map_') ||
                k === 'timeline_gist_data'
            )) {
                keysToRemove.push(k);
            }
        }
        
        keysToRemove.forEach(key => {
            try {
                localStorage.removeItem(key);
                cleaned++;
                log('Removed old key:', key);
            } catch(e) {
                logError('Error removing', key, ':', e);
            }
        });
        
        if (cleaned > 0) {
            log('Cleaned up', cleaned, 'old keys');
        }
        return cleaned;
    }

    // ============== ПОЛУЧЕНИЕ НАСТРОЕК ОЧИСТКИ ==============
    function getCleanupConfig() {
        return Lampa.Storage.get('timeline_cleanup_config', { ...DEFAULT_CLEANUP_CONFIG });
    }

    function saveCleanupConfig(cfg) {
        Lampa.Storage.set('timeline_cleanup_config', cfg);
    }

    // ============== ОПРЕДЕЛЕНИЕ ТИПА КОНТЕНТА ==============
    function getContentType(movie) {
        if (!movie) return 'unknown';
        if (movie.original_name) return 'tv';
        if (movie.original_title) return 'movie';
        if (movie.title) return 'movie';
        return 'unknown';
    }

    // ============== КЭШИРОВАНИЕ ИНФОРМАЦИИ О СЕРИАЛЕ ==============
    function cacheSeriesInfo(movie) {
        if (!movie || getContentType(movie) !== 'tv') return;
        
        try {
            const seriesCache = Lampa.Storage.get('series_cache', {});
            const name = movie.original_name || movie.name || movie.title;
            
            if (movie.seasons || movie.number_of_seasons || movie.episodes) {
                seriesCache[name] = {
                    seasons: movie.seasons || [],
                    number_of_seasons: movie.number_of_seasons || 0,
                    episodes: movie.episodes || [],
                    season_episodes: movie.season_episodes || 0,
                    original_name: movie.original_name || movie.name || movie.title,
                    timestamp: Date.now()
                };
                
                const keys = Object.keys(seriesCache);
                if (keys.length > 50) {
                    keys.sort((a, b) => {
                        return (seriesCache[a].timestamp || 0) - (seriesCache[b].timestamp || 0);
                    });
                    const toRemove = keys.slice(0, keys.length - 50);
                    toRemove.forEach(key => {
                        delete seriesCache[key];
                    });
                }
                
                Lampa.Storage.set('series_cache', seriesCache);
                log('Cached series info:', name);
            }
        } catch(e) {
            logError('Error caching series info:', e);
        }
    }

    // ============== ПОЛУЧЕНИЕ ИНФОРМАЦИИ О СЕРИАЛЕ ИЗ КЭША ==============
    function getSeriesInfoFromCache(seriesName) {
        try {
            const seriesCache = Lampa.Storage.get('series_cache', {});
            if (seriesCache[seriesName]) {
                return seriesCache[seriesName];
            }
            
            for (const key in seriesCache) {
                if (seriesName.includes(key) || key.includes(seriesName)) {
                    return seriesCache[key];
                }
            }
            
            return null;
        } catch(e) {
            return null;
        }
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ ХЕШЕЙ ДЛЯ СЕРИАЛА ==============
    function getSeriesHashes(movie, timelineData) {
        const hashes = [];
        if (!movie || getContentType(movie) !== 'tv') return hashes;
        
        try {
            const name = movie.original_name || movie.name || movie.title;
            
            let seasons = [];
            let totalEpisodes = 0;
            
            if (movie.seasons && Array.isArray(movie.seasons) && movie.seasons.length > 0) {
                seasons = movie.seasons;
            } else if (movie.number_of_seasons) {
                for (let s = 1; s <= movie.number_of_seasons; s++) {
                    seasons.push({ season_number: s, episode_count: 0 });
                }
            }
            
            if (movie.season_episodes) {
                totalEpisodes = movie.season_episodes;
            }
            
            if (movie.episodes && Array.isArray(movie.episodes) && movie.episodes.length > 0) {
                const episodesBySeason = {};
                movie.episodes.forEach(ep => {
                    const seasonNum = ep.season_number || 1;
                    if (!episodesBySeason[seasonNum]) {
                        episodesBySeason[seasonNum] = [];
                    }
                    episodesBySeason[seasonNum].push(ep);
                });
                
                for (const seasonNum in episodesBySeason) {
                    const eps = episodesBySeason[seasonNum];
                    eps.forEach(ep => {
                        const epNum = ep.episode_number || ep.number || 1;
                        const hashString = [seasonNum, seasonNum > 10 ? ':' : '', epNum, name].join('');
                        const hash = Lampa.Utils.hash(hashString);
                        hashes.push({
                            hash: hash,
                            season: parseInt(seasonNum),
                            episode: parseInt(epNum),
                            data: ep
                        });
                    });
                }
                
                return hashes;
            }
            
            if (seasons.length > 0) {
                seasons.forEach(season => {
                    const seasonNum = season.season_number || season.number || 1;
                    const epCount = season.episode_count || season.episodes || 0;
                    
                    if (epCount > 0) {
                        for (let e = 1; e <= epCount; e++) {
                            const hashString = [seasonNum, seasonNum > 10 ? ':' : '', e, name].join('');
                            const hash = Lampa.Utils.hash(hashString);
                            hashes.push({
                                hash: hash,
                                season: seasonNum,
                                episode: e,
                                data: null
                            });
                        }
                    }
                });
                
                return hashes;
            }
            
            if (totalEpisodes > 0) {
                for (let e = 1; e <= totalEpisodes; e++) {
                    const hashString = [1, ':', e, name].join('');
                    const hash = Lampa.Utils.hash(hashString);
                    hashes.push({
                        hash: hash,
                        season: 1,
                        episode: e,
                        data: null
                    });
                }
            }
            
            if (hashes.length === 0 && timelineData) {
                const nameHash = Lampa.Utils.hash(name);
                
                for (const hash in timelineData) {
                    if (hash.includes(nameHash) || hash.includes(name)) {
                        const match = hash.match(/_s(\d+)_e(\d+)/);
                        if (match) {
                            hashes.push({
                                hash: hash,
                                season: parseInt(match[1]),
                                episode: parseInt(match[2]),
                                data: null
                            });
                        }
                    }
                }
            }
        } catch(e) {
            logError('Error getting series hashes:', e);
        }
        
        return hashes;
    }

    // ============== ПРОВЕРКА ПРОСМОТРА СЕРИАЛА ==============
    function isSeriesFullyWatched(movie, timelines) {
        if (!movie || getContentType(movie) !== 'tv') return false;
        
        try {
            const seriesInfo = getSeriesHashes(movie, timelines);
            if (seriesInfo.length === 0) return false;
            
            let watchedCount = 0;
            const threshold = getCleanupConfig().percentThreshold || 95;
            
            seriesInfo.forEach(item => {
                if (timelines[item.hash]) {
                    const percent = timelines[item.hash].percent || 0;
                    if (percent >= threshold) {
                        watchedCount++;
                    }
                }
            });
            
            const watchRate = watchedCount / seriesInfo.length;
            return watchRate >= 0.9;
        } catch(e) {
            logError('Error checking series watch status:', e);
            return false;
        }
    }

    // ============== ОЧИСТКА ТАЙМЛАЙНОВ ==============
    function cleanupTimelines(showNotify = true) {
        const cleanupConfig = getCleanupConfig();
        if (!cleanupConfig.enabled) {
            if (showNotify) notify('⚠️ Автоочистка отключена');
            return false;
        }

        log('Starting cleanup...');
        
        const timelines = getAllTimelines();
        const hashes = Object.keys(timelines);
        const now = Date.now();
        
        if (hashes.length === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для очистки');
            return false;
        }
        
        const sortedHashes = hashes.sort((a, b) => {
            return (timelines[a].updatedAt || 0) - (timelines[b].updatedAt || 0);
        });
        
        const toRemove = [];
        const daysThreshold = cleanupConfig.daysThreshold || 30;
        const percentThreshold = cleanupConfig.percentThreshold || 95;
        const maxCount = cleanupConfig.maxCount || 100;
        
        const daysAgo = now - (daysThreshold * 24 * 60 * 60 * 1000);
        sortedHashes.forEach(hash => {
            const item = timelines[hash];
            if (item.updatedAt && item.updatedAt < daysAgo) {
                if (!toRemove.includes(hash)) {
                    toRemove.push(hash);
                }
            }
        });
        
        const movieHashes = [];
        const seriesGroups = {};
        const seriesNames = {};
        
        sortedHashes.forEach(hash => {
            const item = timelines[hash];
            
            let isSeries = false;
            let seriesName = '';
            let seriesInfo = null;
            
            const hashStr = hash.toString();
            if (hashStr.match(/_s\d+_e\d+/) || hashStr.match(/\d+:\d+/)) {
                isSeries = true;
                const parts = hashStr.split('_');
                if (parts.length >= 3) {
                    seriesName = parts.slice(0, -2).join('_');
                } else {
                    seriesName = hashStr.replace(/_\d+_s\d+_e\d+$/, '');
                }
                
                seriesInfo = getSeriesInfoFromCache(seriesName);
            }
            
            if (isSeries && seriesName) {
                if (!seriesGroups[seriesName]) {
                    seriesGroups[seriesName] = {
                        episodes: [],
                        info: seriesInfo
                    };
                }
                seriesGroups[seriesName].episodes.push({
                    hash: hash,
                    item: item
                });
                seriesNames[hash] = seriesName;
            } else {
                movieHashes.push(hash);
            }
        });
        
        movieHashes.forEach(hash => {
            const item = timelines[hash];
            if (item.percent >= percentThreshold) {
                if (!toRemove.includes(hash)) {
                    toRemove.push(hash);
                }
            }
        });
        
        for (const seriesName in seriesGroups) {
            const group = seriesGroups[seriesName];
            const episodes = group.episodes;
            const seriesInfo = group.info;
            
            let watchedCount = 0;
            let totalCount = episodes.length;
            
            if (seriesInfo) {
                const allHashes = getSeriesHashes(seriesInfo);
                totalCount = allHashes.length;
                
                allHashes.forEach(item => {
                    if (timelines[item.hash]) {
                        const percent = timelines[item.hash].percent || 0;
                        if (percent >= percentThreshold) {
                            watchedCount++;
                        }
                    }
                });
            } else {
                episodes.forEach(ep => {
                    if (ep.item.percent >= percentThreshold) {
                        watchedCount++;
                    }
                });
            }
            
            if (totalCount > 0 && (watchedCount / totalCount) >= 0.9) {
                const hashesToRemove = getSeriesHashesForCleanup(seriesName, timelines);
                hashesToRemove.forEach(hash => {
                    if (!toRemove.includes(hash)) {
                        toRemove.push(hash);
                    }
                });
                log('Series fully watched, removing:', seriesName, 'episodes:', totalCount);
            }
        }
        
        if (toRemove.length < sortedHashes.length - maxCount) {
            const keepHashes = sortedHashes.filter(hash => !toRemove.includes(hash));
            if (keepHashes.length > maxCount) {
                const extraToRemove = keepHashes.slice(0, keepHashes.length - maxCount);
                extraToRemove.forEach(hash => {
                    if (!toRemove.includes(hash)) {
                        toRemove.push(hash);
                    }
                });
            }
        }
        
        if (toRemove.length === 0) {
            if (showNotify) notify('✅ Нет таймлайнов для удаления');
            return false;
        }
        
        const keys = getAllTimelineKeys();
        let removedCount = 0;
        
        keys.forEach(key => {
            try {
                const storage = Lampa.Storage.get(key, {});
                toRemove.forEach(hash => {
                    if (storage[hash]) {
                        delete storage[hash];
                        removedCount++;
                    }
                });
                Lampa.Storage.set(key, storage);
            } catch(e) {
                logError('Error removing from', key, ':', e);
            }
        });
        
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            syncToGist(false);
        }
        
        if (showNotify) {
            notify('🧹 Удалено ' + toRemove.length + ' таймлайнов');
        }
        
        log('Cleanup complete, removed:', toRemove.length);
        return true;
    }

    // ============== ПОЛУЧЕНИЕ ХЕШЕЙ СЕРИАЛА ДЛЯ ОЧИСТКИ ==============
    function getSeriesHashesForCleanup(seriesName, timelines) {
        const hashes = [];
        
        const seriesInfo = getSeriesInfoFromCache(seriesName);
        if (seriesInfo) {
            const allHashes = getSeriesHashes(seriesInfo);
            allHashes.forEach(item => {
                hashes.push(item.hash);
            });
            return hashes;
        }
        
        for (const hash in timelines) {
            if (hash.includes(seriesName)) {
                hashes.push(hash);
            }
        }
        
        return hashes;
    }

    // ============== ОЧИСТКА ЛОКАЛЬНЫХ ТАЙМЛАЙНОВ ==============
    function clearLocalTimelines(showNotify = true) {
        const keys = getAllTimelineKeys();
        let clearedCount = 0;
        
        keys.forEach(key => {
            try {
                Lampa.Storage.set(key, {});
                clearedCount++;
                log('Cleared', key);
            } catch(e) {
                logError('Error clearing', key, ':', e);
            }
        });
        
        try {
            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                Lampa.Timeline.read(true);
            }
        } catch(e) {
            logError('Error clearing timeline cache:', e);
        }
        
        if (showNotify) {
            notify('🧹 Очищено ' + clearedCount + ' хранилищ таймлайнов');
        }
        
        log('Local timelines cleared');
        return clearedCount;
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ ТАЙМЛАЙНОВ ==============
    function getAllTimelines() {
        const allTimelines = {};
        const now = Date.now();
        const keys = getAllTimelineKeys();
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                if (typeof data === 'object' && data !== null) {
                    for (const hash in data) {
                        const item = data[hash];
                        if (!item || !item.time || item.time <= 0) continue;
                        
                        const updated = item.updated || item.timestamp || now;
                        
                        if (allTimelines[hash]) {
                            if (updated > allTimelines[hash].updatedAt) {
                                allTimelines[hash] = {
                                    time: Math.round(item.time),
                                    duration: Math.round(item.duration || 0),
                                    percent: Math.round(item.percent || 0),
                                    updatedAt: updated,
                                    source: key
                                };
                            }
                        } else {
                            allTimelines[hash] = {
                                time: Math.round(item.time),
                                duration: Math.round(item.duration || 0),
                                percent: Math.round(item.percent || 0),
                                updatedAt: updated,
                                source: key
                            };
                        }
                    }
                }
            } catch(e) {
                logError('Error reading', key, ':', e);
            }
        });
        
        return allTimelines;
    }

    // ============== СОХРАНЕНИЕ ТАЙМЛАЙНОВ ВО ВСЕ ХРАНИЛИЩА ==============
    function saveTimelinesToAllStorages(timelines) {
        const keys = getAllTimelineKeys();
        let saved = 0;

        const dataByKey = {};
        keys.forEach(key => {
            dataByKey[key] = {};
        });

        for (const hash in timelines) {
            const item = timelines[hash];
            const data = {
                time: item.time,
                duration: item.duration || 0,
                percent: item.percent || 0,
                updated: item.updatedAt || Date.now()
            };
            
            for (const key in dataByKey) {
                dataByKey[key][hash] = data;
            }
        }

        for (const key in dataByKey) {
            if (Object.keys(dataByKey[key]).length > 0) {
                Lampa.Storage.set(key, dataByKey[key]);
                saved++;
                log('Saved to', key, ':', Object.keys(dataByKey[key]).length, 'items');
            }
        }
        
        return saved;
    }

    // ============== СОХРАНЕНИЕ ОДНОГО ТАЙМЛАЙНА ==============
    function saveTimelineToFileView(hash, time, duration, percent) {
        if (!hash || !time || time <= 0) return;

        const now = Date.now();
        const keys = getAllTimelineKeys();
        
        log('SAVING:', hash, 'time:', time, 'percent:', percent);
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                data[hash] = {
                    time: Math.round(time),
                    duration: Math.round(duration || 0),
                    percent: Math.round(percent || 0),
                    updated: now
                };
                Lampa.Storage.set(key, data);
            } catch(e) {
                logError('Error saving to', key, ':', e);
            }
        });
        
        scheduleSync();
        
        // Обновляем интерфейс с задержкой
        setTimeout(function() {
            safeTimelineUpdate(hash, { time, duration, percent });
        }, 500);
    }

    // ============== БЕЗОПАСНОЕ ОБНОВЛЕНИЕ ТАЙМЛАЙНА ==============
    function safeTimelineUpdate(hash, data) {
        try {
            // Проверяем, что Lampa полностью загружена
            if (typeof Lampa === 'undefined' || !Lampa.Timeline) {
                log('Lampa not ready, delaying update');
                setTimeout(function() {
                    safeTimelineUpdate(hash, data);
                }, 1000);
                return;
            }
            
            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                try {
                    Lampa.Timeline.read(true);
                } catch(e) {
                    // Игнорируем
                }
            }
            
            if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
                try {
                    Lampa.Timeline.update({
                        hash: hash,
                        time: data.time,
                        duration: data.duration || 0,
                        percent: data.percent || 0,
                        force: true
                    });
                } catch(e) {
                    // Игнорируем
                }
            }
            
            // Проверяем наличие элементов перед обновлением
            const playData = Lampa.Player ? Lampa.Player.playdata() : null;
            if (playData && playData.timeline) {
                playData.timeline.time = data.time;
                playData.timeline.percent = data.percent || 0;
                playData.timeline.duration = data.duration || 0;
            }
            
            const activity = Lampa.Activity ? Lampa.Activity.active() : null;
            const movie = activity?.movie;
            if (movie) {
                if (movie.timeline) {
                    movie.timeline.time = data.time;
                    movie.timeline.percent = data.percent || 0;
                    movie.timeline.duration = data.duration || 0;
                }
                
                if (Lampa.Listener) {
                    try {
                        Lampa.Listener.send('full', {
                            type: 'update',
                            data: { 
                                movie: movie, 
                                hash: hash,
                                timeline: {
                                    time: data.time,
                                    percent: data.percent || 0,
                                    duration: data.duration || 0
                                }
                            }
                        });
                        
                        Lampa.Listener.send('state:changed', {
                            target: 'timeline',
                            reason: 'update',
                            data: { hash: hash, road: {
                                time: data.time,
                                percent: data.percent || 0,
                                duration: data.duration || 0
                            }}
                        });
                    } catch(e) {
                        // Игнорируем
                    }
                }
            }
            
            if (Lampa.Timeline && typeof Lampa.Timeline.render === 'function') {
                try {
                    Lampa.Timeline.render();
                } catch(e) {
                    // Игнорируем
                }
            }
            
            // Обновляем DOM элементы с проверкой на существование
            try {
                $('.time-line[data-hash="'+hash+'"]').each(function(){
                    try {
                        $(this).toggleClass('hide', data.percent ? false : true);
                        $('> div', this).css('width', data.percent + '%');
                    } catch(e) {
                        // Игнорируем
                    }
                });
            } catch(e) {
                // Игнорируем
            }
            
            try {
                $('.time-line-details[data-hash="'+hash+'"]').each(function(){
                    try {
                        const f = Lampa.Timeline && Lampa.Timeline.format ? Lampa.Timeline.format({
                            time: data.time,
                            duration: data.duration || 0,
                            percent: data.percent || 0
                        }) : {
                            time: Lampa.Utils ? Lampa.Utils.secondsToTimeHuman(data.time) : data.time,
                            duration: Lampa.Utils ? Lampa.Utils.secondsToTimeHuman(data.duration || 0) : data.duration,
                            percent: data.percent + '%'
                        };
                        $(this).find('[a="t"]').text(f.time);
                        $(this).find('[a="p"]').text(f.percent);
                        $(this).find('[a="d"]').text(f.duration);
                        $(this).toggleClass('hide', data.duration ? false : true);
                    } catch(e) {
                        // Игнорируем
                    }
                });
            } catch(e) {
                // Игнорируем
            }
            
            log('UI updated for', hash);
        } catch(e) {
            logError('UI update error:', e);
        }
    }

    // ============== ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ==============
    function forceUIUpdate(hash, data) {
        setTimeout(function() {
            safeTimelineUpdate(hash, data);
        }, 300);
    }

    // ============== ПРИНУДИТЕЛЬНОЕ ПРИМЕНЕНИЕ ДАННЫХ ==============
    function forceApplyTimeline(hash, data) {
        if (!hash || !data || !data.time) return false;
        
        log('FORCE APPLY:', hash, 'time:', data.time, 'percent:', data.percent);
        
        const now = Date.now();
        const keys = getAllTimelineKeys();
        
        keys.forEach(key => {
            try {
                const storage = Lampa.Storage.get(key, {});
                storage[hash] = {
                    time: data.time,
                    duration: data.duration || 0,
                    percent: data.percent || 0,
                    updated: data.updatedAt || now
                };
                Lampa.Storage.set(key, storage);
            } catch(e) {
                logError('Error saving to', key, ':', e);
            }
        });
        
        forceUIUpdate(hash, data);
        
        if (data.percent) {
            notify('📥 Прогресс обновлен: ' + Math.round(data.percent) + '%');
        }
        
        return true;
    }

    // ============== ХРАНИЛИЩЕ КОНФИГА ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            enabled: true,
            autoSync: true
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg);
    }

    function notify(text) {
        if (Lampa.Noty) {
            Lampa.Noty.show(text);
        } else {
            console.log('[TimelineSync]', text);
        }
    }

    // ============== РАБОТА С GIST ==============
    function syncToGist(showNotify = true) {
        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        cleanupOldData();

        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        log('SYNC TO GIST:', count, 'timelines');

        const data = {
            description: 'Lampa Timeline Sync',
            public: false,
            files: {
                'timeline.json': {
                    content: JSON.stringify({
                        version: 2,
                        profile: getProfileId() || 'default',
                        updated: new Date().toISOString(),
                        count: count,
                        timelines: timelines
                    }, null, 2)
                }
            }
        };

        const url = GIST_API + '/' + cfg.gistId;
        
        fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(function(response) {
            if (!response.ok) {
                throw { status: response.status, statusText: response.statusText };
            }
            return response.json();
        })
        .then(function(response) {
            cfg.lastSync = Date.now();
            saveConfig(cfg);
            if (showNotify) notify('✅ Синхронизировано ' + count + ' таймлайнов');
            log('Sync complete');
        })
        .catch(function(err) {
            logError('Sync error:', err.status || 'unknown');
            if (err.status === 404) {
                createNewGist(showNotify);
            } else {
                if (showNotify) notify('❌ Ошибка синхронизации: ' + (err.status || 'unknown'));
            }
        });

        return true;
    }

    function createNewGist(showNotify = true) {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        const data = {
            description: 'Lampa Timeline Sync',
            public: false,
            files: {
                'timeline.json': {
                    content: JSON.stringify({
                        version: 2,
                        profile: getProfileId() || 'default',
                        updated: new Date().toISOString(),
                        count: count,
                        timelines: timelines
                    }, null, 2)
                }
            }
        };

        fetch(GIST_API, {
            method: 'POST',
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(function(response) {
            if (!response.ok) {
                throw { status: response.status, statusText: response.statusText };
            }
            return response.json();
        })
        .then(function(response) {
            if (response && response.id) {
                cfg.gistId = response.id;
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                if (showNotify) notify('✅ Создан новый Gist: ' + response.id);
                log('New Gist created:', response.id);
            } else {
                if (showNotify) notify('❌ Не удалось создать Gist');
            }
        })
        .catch(function(err) {
            logError('Create Gist error:', err.status || 'unknown');
            if (showNotify) notify('❌ Ошибка создания Gist: ' + (err.status || 'unknown'));
        });

        return true;
    }

    function syncFromGist(showNotify = true, applyImmediately = false) {
        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        cleanupOldData();

        log('LOADING from Gist...');

        const url = GIST_API + '/' + cfg.gistId;
        
        fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json'
            }
        })
        .then(function(response) {
            if (!response.ok) {
                throw { status: response.status, statusText: response.statusText };
            }
            return response.json();
        })
        .then(function(data) {
            try {
                const content = data.files && data.files['timeline.json'] ? data.files['timeline.json'].content : null;
                
                if (!content) {
                    if (showNotify) notify('⚠️ Файл timeline.json не найден');
                    return;
                }

                const remote = JSON.parse(content);
                const remoteTimelines = remote.timelines || {};
                
                log('Gist has', Object.keys(remoteTimelines).length, 'timelines');
                
                if (Object.keys(remoteTimelines).length === 0) {
                    if (showNotify) notify('⚠️ В Gist нет таймлайнов');
                    return;
                }

                const localTimelines = getAllTimelines();
                let changes = 0;
                let merged = { ...localTimelines };

                for (const hash in remoteTimelines) {
                    const remoteData = remoteTimelines[hash];
                    const localData = merged[hash];
                    
                    if (!localData) {
                        merged[hash] = remoteData;
                        changes++;
                        log('New from Gist:', hash);
                        continue;
                    }
                    
                    const remoteUpdated = remoteData.updatedAt || 0;
                    const localUpdated = localData.updatedAt || 0;
                    
                    if (remoteUpdated > localUpdated) {
                        merged[hash] = remoteData;
                        changes++;
                        log('Updated from Gist:', hash);
                    }
                }

                if (changes > 0) {
                    saveTimelinesToAllStorages(merged);
                    
                    const activity = Lampa.Activity ? Lampa.Activity.active() : null;
                    const movie = activity?.movie;
                    if (movie && getContentType(movie) === 'tv') {
                        cacheSeriesInfo(movie);
                    }
                    
                    if (applyImmediately && movie) {
                        const hash = generateHash(movie);
                        if (hash && merged[hash]) {
                            // Откладываем применение, чтобы Lampa успела загрузиться
                            setTimeout(function() {
                                forceApplyTimeline(hash, merged[hash]);
                            }, 1000);
                        }
                    }
                    
                    if (showNotify) notify('📥 Загружено ' + changes + ' таймлайнов');
                } else {
                    if (showNotify) notify('✅ Данные актуальны');
                }

                cfg.lastSync = Date.now();
                saveConfig(cfg);

            } catch(e) {
                logError('Parse error:', e);
                if (showNotify) notify('❌ Ошибка чтения данных');
            }
        })
        .catch(function(err) {
            logError('Load error:', err.status || 'unknown');
            if (err.status === 404) {
                if (showNotify) notify('❌ Gist не найден (404)');
            } else {
                if (showNotify) notify('❌ Ошибка загрузки: ' + (err.status || 'unknown'));
            }
        });

        return true;
    }

    // ============== ГЕНЕРАЦИЯ ХЕША ==============
    function generateHash(movie, season, episode) {
        if (!movie) return null;
        
        try {
            if (movie.original_name) {
                const s = season || 1;
                const e = episode || 1;
                const hashString = [s, s > 10 ? ':' : '', e, movie.original_name].join('');
                return Lampa.Utils ? Lampa.Utils.hash(hashString) : null;
            } else if (movie.original_title) {
                return Lampa.Utils ? Lampa.Utils.hash(movie.original_title) : null;
            } else if (movie.title) {
                return Lampa.Utils ? Lampa.Utils.hash(movie.title) : null;
            }
        } catch(e) {
            logError('Hash generation error:', e);
        }
        return null;
    }

    function getCurrentHash() {
        const activity = Lampa.Activity ? Lampa.Activity.active() : null;
        const movie = activity?.movie;
        if (!movie) return null;
        
        let season = activity?.season || 1;
        let episode = activity?.episode || 1;
        
        if (movie.original_title) {
            return generateHash(movie);
        }
        
        return generateHash(movie, season, episode);
    }

    // ============== НАСТРОЙКИ ОЧИСТКИ ==============
    function setupCleanupSettings() {
        try {
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_section',
                        type: 'title'
                    },
                    field: {
                        name: '🧹 Автоочистка таймлайнов'
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_enabled',
                        type: 'toggle',
                        default: false
                    },
                    field: {
                        name: 'Включить автоочистку',
                        description: 'Автоматическое удаление старых таймлайнов'
                    },
                    onChange: function(value) {
                        const cfg = getCleanupConfig();
                        cfg.enabled = value === 'true';
                        saveCleanupConfig(cfg);
                        log('Cleanup enabled:', cfg.enabled);
                    },
                    onRender: function(item) {
                        const cfg = getCleanupConfig();
                        if (cfg.enabled) {
                            item.find('.settings-param__value').addClass('active');
                        }
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_max_count',
                        type: 'input',
                        placeholder: '100',
                        default: '100'
                    },
                    field: {
                        name: 'Максимальное количество',
                        description: 'Максимальное количество таймлайнов в Gist (0 - без ограничения)'
                    },
                    onChange: function(value) {
                        const cfg = getCleanupConfig();
                        const num = parseInt(value) || 0;
                        cfg.maxCount = num;
                        saveCleanupConfig(cfg);
                        log('Max count:', cfg.maxCount);
                    },
                    onRender: function(item) {
                        const cfg = getCleanupConfig();
                        item.find('.settings-param__value').text(cfg.maxCount || '0');
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_percent_threshold',
                        type: 'input',
                        placeholder: '95',
                        default: '95'
                    },
                    field: {
                        name: 'Порог процента просмотра',
                        description: 'Таймлайны с процентом выше этого значения будут удалены (0-100)'
                    },
                    onChange: function(value) {
                        const cfg = getCleanupConfig();
                        const num = parseInt(value) || 0;
                        cfg.percentThreshold = Math.min(100, Math.max(0, num));
                        saveCleanupConfig(cfg);
                        log('Percent threshold:', cfg.percentThreshold);
                    },
                    onRender: function(item) {
                        const cfg = getCleanupConfig();
                        item.find('.settings-param__value').text(cfg.percentThreshold + '%');
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_days_threshold',
                        type: 'input',
                        placeholder: '30',
                        default: '30'
                    },
                    field: {
                        name: 'Количество дней',
                        description: 'Таймлайны старше этого количества дней будут удалены (0 - без ограничения)'
                    },
                    onChange: function(value) {
                        const cfg = getCleanupConfig();
                        const num = parseInt(value) || 0;
                        cfg.daysThreshold = num;
                        saveCleanupConfig(cfg);
                        log('Days threshold:', cfg.daysThreshold);
                    },
                    onRender: function(item) {
                        const cfg = getCleanupConfig();
                        item.find('.settings-param__value').text(cfg.daysThreshold + ' дней');
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_auto',
                        type: 'toggle',
                        default: false
                    },
                    field: {
                        name: 'Автоматическая очистка',
                        description: 'Периодическая очистка таймлайнов в фоновом режиме'
                    },
                    onChange: function(value) {
                        const cfg = getCleanupConfig();
                        cfg.autoCleanup = value === 'true';
                        saveCleanupConfig(cfg);
                        if (cfg.autoCleanup) {
                            startAutoCleanup();
                        } else {
                            stopAutoCleanup();
                        }
                        log('Auto cleanup:', cfg.autoCleanup);
                    },
                    onRender: function(item) {
                        const cfg = getCleanupConfig();
                        if (cfg.autoCleanup) {
                            item.find('.settings-param__value').addClass('active');
                        }
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_now',
                        type: 'button'
                    },
                    field: {
                        name: '🧹 Очистить сейчас',
                        description: 'Запустить очистку таймлайнов вручную'
                    },
                    onChange: function() {
                        cleanupTimelines(true);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'clear_all',
                        type: 'button'
                    },
                    field: {
                        name: '🗑️ Очистить все локальные таймлайны',
                        description: 'Удалить все таймлайны из локального хранилища (не влияет на Gist)'
                    },
                    onChange: function() {
                        Lampa.Select.show({
                            title: '⚠️ Подтверждение',
                            items: [
                                { title: '✅ Да, очистить все', action: 'confirm' },
                                { title: '❌ Отмена', action: 'cancel' }
                            ],
                            onSelect: function(item) {
                                if (item.action === 'confirm') {
                                    clearLocalTimelines(true);
                                }
                            }
                        });
                    }
                });
            }

            log('Cleanup settings initialized');
        } catch(e) {
            logError('Cleanup settings error:', e);
        }
    }

    // ============== АВТОМАТИЧЕСКАЯ ОЧИСТКА ==============
    var cleanupTimer = null;

    function startAutoCleanup() {
        stopAutoCleanup();
        const cfg = getCleanupConfig();
        if (!cfg.autoCleanup) return;
        
        const interval = cfg.cleanupInterval || 24 * 60 * 60 * 1000;
        cleanupTimer = setInterval(function() {
            log('Auto cleanup triggered');
            cleanupTimelines(false);
        }, interval);
        
        log('Auto cleanup started, interval:', interval / 1000 / 60, 'minutes');
    }

    function stopAutoCleanup() {
        if (cleanupTimer) {
            clearInterval(cleanupTimer);
            cleanupTimer = null;
            log('Auto cleanup stopped');
        }
    }

    // ============== ОЧИСТКА СТАРОГО КЭША ==============
    function cleanOldSeriesCache() {
        try {
            const seriesCache = Lampa.Storage.get('series_cache', {});
            const now = Date.now();
            const maxAge = 30 * 24 * 60 * 60 * 1000;
            let changed = false;
            
            for (const key in seriesCache) {
                const item = seriesCache[key];
                if (item.timestamp && (now - item.timestamp) > maxAge) {
                    delete seriesCache[key];
                    changed = true;
                }
            }
            
            if (changed) {
                Lampa.Storage.set('series_cache', seriesCache);
                log('Cleaned old series cache');
            }
        } catch(e) {
            logError('Error cleaning series cache:', e);
        }
    }

    // ============== ИНИЦИАЛИЗАЦИЯ НАСТРОЕК ==============
    function setupSettings() {
        try {
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
                Lampa.SettingsApi.addComponent({
                    component: 'timeline_gist',
                    name: 'Синхронизация таймлайнов',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
                });
            }

            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_gist_setup',
                        type: 'button'
                    },
                    field: {
                        name: '☁️ Настройка Gist',
                        description: 'GitHub Gist для синхронизации прогресса'
                    },
                    onChange: function() {
                        showGistSetup();
                    }
                });

                setupCleanupSettings();
            }

            log('Settings initialized');
        } catch(e) {
            logError('Settings setup error:', e);
            addMenuItem();
        }
    }

    // ============== ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ ==============
    function addMenuItem() {
        setTimeout(function() {
            var ml = $('.menu__list').eq(0);
            if (!ml.length) return;
            
            if ($('.timeline-gist-menu-item').length) return;
            
            var el = $(
                '<li class="menu__item selector timeline-gist-menu-item">' +
                    '<div class="menu__ico">' +
                        '<svg viewBox="0 0 24 24" width="20" height="20">' +
                            '<path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="menu__text">Синхр. таймлайнов</div>' +
                '</li>'
            );
            
            el.on('hover:enter', function(e) {
                e.stopPropagation();
                showGistSetup();
            });
            
            ml.append(el);
            log('Menu item added (fallback)');
        }, 2000);
    }

    // ============== ДИАЛОГ НАСТРОЕК ==============
    function showGistSetup() {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        const profileId = getProfileId() || 'не задан';
        
        const cleanupCfg = getCleanupConfig();
        const cleanupStatus = cleanupCfg.enabled ? '✅ Вкл' : '❌ Выкл';
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: [
                { title: '🔑 Токен: ' + (cfg.token ? '✅ Установлен' : '❌ Не установлен'), action: 'token' },
                { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), action: 'id' },
                { title: '👤 Profile ID: ' + profileId, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📊 Таймлайнов: ' + count, action: 'status' },
                { title: '🔄 Последняя синхр.: ' + lastSync, action: 'status' },
                { title: '🧹 Автоочистка: ' + cleanupStatus, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), action: 'toggle_auto' },
                { title: '──────────', separator: true },
                { title: '🧹 Очистить старые ключи', action: 'cleanup' },
                { title: '🧹 Очистить таймлайны (по правилам)', action: 'cleanup_timelines' },
                { title: '🗑️ Очистить все локальные таймлайны', action: 'clear_all' },
                { title: '──────────', separator: true },
                { title: '❌ Закрыть', action: 'cancel' }
            ],
            onSelect: function(item) {
                const newCfg = getConfig();
                
                if (item.action === 'token') {
                    Lampa.Input.edit({
                        title: 'GitHub Personal Access Token (права: gist)',
                        value: cfg.token,
                        nosave: true
                    }, function(val) {
                        if (val !== null) {
                            newCfg.token = val || '';
                            saveConfig(newCfg);
                            notify('Токен сохранён');
                        }
                        showGistSetup();
                    });
                } else if (item.action === 'id') {
                    Lampa.Input.edit({
                        title: 'Gist ID (оставьте пустым для создания)',
                        value: cfg.gistId,
                        nosave: true
                    }, function(val) {
                        if (val !== null) {
                            newCfg.gistId = val || '';
                            saveConfig(newCfg);
                            notify('Gist ID сохранён');
                        }
                        showGistSetup();
                    });
                } else if (item.action === 'upload') {
                    syncToGist(true);
                    setTimeout(function() {
                        showGistSetup();
                    }, 2000);
                } else if (item.action === 'download') {
                    syncFromGist(true, true);
                    setTimeout(function() {
                        showGistSetup();
                    }, 2000);
                } else if (item.action === 'toggle_auto') {
                    newCfg.autoSync = !newCfg.autoSync;
                    saveConfig(newCfg);
                    notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                    showGistSetup();
                } else if (item.action === 'cleanup') {
                    const cleaned = cleanupOldData();
                    notify('🧹 Очищено ' + cleaned + ' старых ключей');
                    setTimeout(function() {
                        showGistSetup();
                    }, 1000);
                } else if (item.action === 'cleanup_timelines') {
                    cleanupTimelines(true);
                    setTimeout(function() {
                        showGistSetup();
                    }, 2000);
                } else if (item.action === 'clear_all') {
                    Lampa.Select.show({
                        title: '⚠️ Подтверждение',
                        items: [
                            { title: '✅ Да, очистить все', action: 'confirm' },
                            { title: '❌ Отмена', action: 'cancel' }
                        ],
                        onSelect: function(confirmItem) {
                            if (confirmItem.action === 'confirm') {
                                clearLocalTimelines(true);
                                setTimeout(function() {
                                    showGistSetup();
                                }, 1000);
                            } else {
                                showGistSetup();
                            }
                        }
                    });
                } else if (item.action === 'status') {
                    showGistSetup();
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============== СОБЫТИЯ ПЛЕЕРА ==============
    var syncTimer = null;
    var currentTimeline = null;
    var isSyncing = false;

    function scheduleSync() {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !isSyncing) {
                isSyncing = true;
                syncToGist(false);
                setTimeout(function() {
                    isSyncing = false;
                }, 5000);
            }
        }, SAVE_DELAY);
    }

    function handleTimelineUpdate(data) {
        if (!data || !data.hash) return;
        
        const activity = Lampa.Activity ? Lampa.Activity.active() : null;
        const movie = activity?.movie;
        if (!movie) return;
        
        const hash = generateHash(movie);
        if (!hash || hash !== data.hash) return;
        
        const time = data.time || 0;
        const duration = data.duration || 0;
        const percent = data.percent || 0;
        
        if (time > 0 && (time !== currentTimeline?.time || Math.abs(time - currentTimeline.time) > 5)) {
            currentTimeline = { time, duration, percent };
            saveTimelineToFileView(hash, time, duration, percent);
        }
    }

    function initPlayerListeners() {
        if (!Lampa.Listener) {
            log('Lampa.Listener not available');
            return;
        }
        
        Lampa.Listener.follow('timeline', function(e) {
            if (e.type === 'update') {
                handleTimelineUpdate(e.data);
            }
        });

        if (Lampa.Player && Lampa.Player.listener) {
            Lampa.Player.listener.follow('timeupdate', function(e) {
                const playData = Lampa.Player ? Lampa.Player.playdata() : null;
                if (playData && playData.timeline) {
                    const activity = Lampa.Activity ? Lampa.Activity.active() : null;
                    const movie = activity?.movie;
                    if (movie) {
                        const hash = generateHash(movie);
                        if (hash) {
                            const time = playData.timeline.time || 0;
                            const duration = playData.timeline.duration || 0;
                            const percent = playData.timeline.percent || 0;
                            
                            if (time > 0 && (time !== currentTimeline?.time || Math.abs(time - currentTimeline.time) > 5)) {
                                currentTimeline = { time, duration, percent };
                                saveTimelineToFileView(hash, time, duration, percent);
                            }
                        }
                    }
                }
                scheduleSync();
            });

            Lampa.Player.listener.follow('pause', function(e) {
                log('Player paused, syncing...');
                const cfg = getConfig();
                if (cfg.token && cfg.gistId && !isSyncing) {
                    isSyncing = true;
                    syncToGist(false);
                    setTimeout(function() {
                        isSyncing = false;
                    }, 5000);
                }
            });

            Lampa.Player.listener.follow('destroy', function() {
                log('Player destroyed, syncing...');
                clearTimeout(syncTimer);
                
                const playData = Lampa.Player ? Lampa.Player.playdata() : null;
                if (playData && playData.timeline) {
                    const activity = Lampa.Activity ? Lampa.Activity.active() : null;
                    const movie = activity?.movie;
                    if (movie) {
                        const hash = generateHash(movie);
                        if (hash) {
                            const time = playData.timeline.time || 0;
                            const duration = playData.timeline.duration || 0;
                            const percent = playData.timeline.percent || 0;
                            
                            if (time > 0) {
                                saveTimelineToFileView(hash, time, duration, percent);
                            }
                        }
                    }
                }
                
                setTimeout(function() {
                    const cfg = getConfig();
                    if (cfg.token && cfg.gistId && !isSyncing) {
                        isSyncing = true;
                        syncToGist(false);
                        setTimeout(function() {
                            isSyncing = false;
                        }, 5000);
                    }
                    currentTimeline = null;
                }, 1000);
            });
        }

        log('Player listeners initialized');
    }

    // ============== ОБРАБОТКА ПРИ ОТКРЫТИИ ФИЛЬМА ==============
    function initActivityListeners() {
        if (!Lampa.Listener) {
            log('Lampa.Listener not available');
            return;
        }
        
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'open') {
                const data = e.data;
                const movie = data?.movie;
                
                if (movie) {
                    cacheSeriesInfo(movie);
                    
                    const hash = generateHash(movie);
                    if (hash) {
                        log('FULL OPEN:', movie.title || movie.original_title, 'hash:', hash);
                        
                        const cfg = getConfig();
                        if (cfg.token && cfg.gistId) {
                            fetch(GIST_API + '/' + cfg.gistId, {
                                headers: {
                                    'Authorization': 'token ' + cfg.token,
                                    'Accept': 'application/vnd.github.v3+json'
                                }
                            })
                            .then(function(response) {
                                if (!response.ok) {
                                    throw { status: response.status };
                                }
                                return response.json();
                            })
                            .then(function(gistData) {
                                try {
                                    const content = gistData.files && gistData.files['timeline.json'] ? gistData.files['timeline.json'].content : null;
                                    if (!content) return;
                                    
                                    const remote = JSON.parse(content);
                                    const remoteTimelines = remote.timelines || {};
                                    
                                    if (remoteTimelines[hash]) {
                                        const remoteData = remoteTimelines[hash];
                                        
                                        const keys = getAllTimelineKeys();
                                        let localUpdated = 0;
                                        
                                        keys.forEach(function(key) {
                                            try {
                                                const storage = Lampa.Storage.get(key, {});
                                                const item = storage[hash];
                                                if (item && item.updated > localUpdated) {
                                                    localUpdated = item.updated;
                                                }
                                            } catch(e) {}
                                        });
                                        
                                        if (remoteData.updatedAt > localUpdated) {
                                            log('Applying Gist timeline for', hash);
                                            setTimeout(function() {
                                                forceApplyTimeline(hash, remoteData);
                                            }, 500);
                                            
                                            currentTimeline = {
                                                time: remoteData.time,
                                                duration: remoteData.duration || 0,
                                                percent: remoteData.percent || 0
                                            };
                                            
                                            if (remoteData.percent) {
                                                notify('📥 Загружен прогресс: ' + Math.round(remoteData.percent) + '%');
                                            }
                                        } else {
                                            log('Local data is newer or equal to Gist for', hash);
                                        }
                                    }
                                } catch(e) {
                                    logError('Error loading from Gist:', e);
                                }
                            })
                            .catch(function(err) {
                                logError('Failed to load Gist:', err.status);
                            });
                        }
                    }
                }
            }
        });
        
        log('Activity listeners initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !isSyncing) {
                const timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    log('Periodic sync');
                    isSyncing = true;
                    syncToGist(false);
                    setTimeout(function() {
                        isSyncing = false;
                    }, 5000);
                }
            }
        }, SYNC_INTERVAL);
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadOnStart() {
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(function() {
                syncFromGist(false, true);
            }, 5000);
        }
        
        const cleanupCfg = getCleanupConfig();
        if (cleanupCfg.autoCleanup) {
            startAutoCleanup();
        }
        
        setInterval(function() {
            integrityCheck();
        }, 5 * 60 * 1000);
    }

    // ============== ПРОВЕРКА ЦЕЛОСТНОСТИ ==============
    function integrityCheck() {
        try {
            const keys = getAllTimelineKeys();
            const mainKey = 'file_view';
            const mainData = Lampa.Storage.get(mainKey, {});
            let changes = 0;
            
            keys.forEach(function(key) {
                if (key === mainKey) return;
                try {
                    const data = Lampa.Storage.get(key, {});
                    for (const hash in data) {
                        if (!mainData[hash] || mainData[hash].updated < data[hash].updated) {
                            mainData[hash] = data[hash];
                            changes++;
                        }
                    }
                } catch(e) {
                    logError('Integrity check error for', key, ':', e);
                }
            });
            
            if (changes > 0) {
                Lampa.Storage.set(mainKey, mainData);
                log('Integrity check: merged', changes, 'items into', mainKey);
                
                const currentHash = getCurrentHash();
                if (currentHash && mainData[currentHash]) {
                    setTimeout(function() {
                        safeTimelineUpdate(currentHash, mainData[currentHash]);
                    }, 500);
                }
            }
        } catch(e) {
            logError('Integrity check error:', e);
        }
    }

    // ============== ОЧИСТКА СТАРОГО КЭША ==============
    function cleanOldSeriesCache() {
        try {
            const seriesCache = Lampa.Storage.get('series_cache', {});
            const now = Date.now();
            const maxAge = 30 * 24 * 60 * 60 * 1000;
            let changed = false;
            
            for (const key in seriesCache) {
                const item = seriesCache[key];
                if (item.timestamp && (now - item.timestamp) > maxAge) {
                    delete seriesCache[key];
                    changed = true;
                }
            }
            
            if (changed) {
                Lampa.Storage.set('series_cache', seriesCache);
                log('Cleaned old series cache');
            }
        } catch(e) {
            logError('Error cleaning series cache:', e);
        }
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        const cfg = getConfig();
        if (!cfg.enabled) {
            log('Disabled');
            return;
        }

        const cleaned = cleanupOldData();
        if (cleaned > 0) {
            log('Cleaned up old data on startup');
        }

        cleanOldSeriesCache();

        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        log('===== INIT =====');
        log('Profile:', getProfileId() || 'default');
        log('Found', count, 'timelines');
        log('Token:', cfg.token ? '✓' : '✗');
        log('Gist ID:', cfg.gistId ? '✓' : '✗');
        log('Auto sync:', cfg.autoSync ? '✓' : '✗');
        log('=================');

        setupSettings();
        initPlayerListeners();
        initActivityListeners();
        startPeriodicSync();
        loadOnStart();

        log('Ready');
    }

    // ============== ЗАПУСК ==============
    if (window.appready) {
        // Даем Lampa время полностью загрузиться
        setTimeout(function() {
            init();
        }, 1000);
    } else {
        Lampa.Listener.follow('app', function(e) {
            if (e.type === 'ready') {
                setTimeout(function() {
                    init();
                }, 1000);
            }
        });
    }

})();
