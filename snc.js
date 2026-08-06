(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;
    const SAVE_DELAY = 2000;
    const FORCE_SYNC_DELAY = 1000;
    const DEBUG = true;

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

    function getFileViewKey() {
        const profileId = getProfileId();
        return profileId ? 'file_view_' + profileId : 'file_view';
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
    function saveTimelineToFileView(hash, time, duration, percent, forceSync = false) {
        if (!hash || !time || time <= 0) return;

        const now = Date.now();
        const keys = getAllTimelineKeys();
        
        log('SAVING:', hash, 'time:', time, 'percent:', percent, 'forceSync:', forceSync);
        
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
        
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
        
        forceUIUpdate(hash, { time, duration, percent });
        
        if (forceSync || percent > 90 || time > 60) {
            forceSyncToGist();
        } else {
            scheduleSync();
        }
    }

    // ============== ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ==============
    function forceUIUpdate(hash, data) {
        try {
            if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
                Lampa.Timeline.update({
                    hash: hash,
                    time: data.time,
                    duration: data.duration || 0,
                    percent: data.percent || 0,
                    force: true
                });
            }
            
            const playData = Lampa.Player.playdata();
            if (playData && playData.timeline) {
                playData.timeline.time = data.time;
                playData.timeline.percent = data.percent || 0;
                playData.timeline.duration = data.duration || 0;
            }
            
            const activity = Lampa.Activity.active();
            const movie = activity?.movie;
            if (movie) {
                if (movie.timeline) {
                    movie.timeline.time = data.time;
                    movie.timeline.percent = data.percent || 0;
                    movie.timeline.duration = data.duration || 0;
                }
                
                if (Lampa.Listener) {
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
                }
            }
            
            if (Lampa.Timeline && typeof Lampa.Timeline.render === 'function') {
                Lampa.Timeline.render();
            }
            
            $('.time-line[data-hash="'+hash+'"]').each(function(){
                $(this).toggleClass('hide', data.percent ? false : true);
                $('> div', this).css('width', data.percent + '%');
            });
            
            $('.time-line-details[data-hash="'+hash+'"]').each(function(){
                const f = Lampa.Timeline.format ? Lampa.Timeline.format({
                    time: data.time,
                    duration: data.duration || 0,
                    percent: data.percent || 0
                }) : {
                    time: Lampa.Utils.secondsToTimeHuman(data.time),
                    duration: Lampa.Utils.secondsToTimeHuman(data.duration || 0),
                    percent: data.percent + '%'
                };
                $(this).find('[a="t"]').text(f.time);
                $(this).find('[a="p"]').text(f.percent);
                $(this).find('[a="d"]').text(f.duration);
                $(this).toggleClass('hide', data.duration ? false : true);
            });
            
            log('UI updated for', hash);
        } catch(e) {
            logError('UI update error:', e);
        }
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

    // ============== ПРИНУДИТЕЛЬНАЯ СИНХРОНИЗАЦИЯ В GIST ==============
    var forceSyncPending = false;
    var forceSyncTimer = null;
    var syncQueue = [];
    var isSyncInProgress = false;

    function forceSyncToGist() {
        if (forceSyncPending) return;
        forceSyncPending = true;
        
        clearTimeout(forceSyncTimer);
        forceSyncTimer = setTimeout(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && !isSyncInProgress) {
                log('Force sync to Gist');
                syncToGistWithRetry(false, 3);
            } else {
                forceSyncPending = false;
            }
        }, FORCE_SYNC_DELAY);
    }

    function syncToGistWithRetry(showNotify = true, maxRetries = 3) {
        if (isSyncInProgress) {
            syncQueue.push({ showNotify, maxRetries });
            return;
        }
        
        isSyncInProgress = true;
        
        const doSync = (retryCount) => {
            syncToGist(showNotify)
                .then((success) => {
                    isSyncInProgress = false;
                    forceSyncPending = false;
                    
                    if (syncQueue.length > 0) {
                        const next = syncQueue.shift();
                        syncToGistWithRetry(next.showNotify, next.maxRetries);
                    }
                    
                    if (success) {
                        log('Sync completed successfully');
                    }
                })
                .catch((err) => {
                    if (retryCount > 0) {
                        log('Sync failed, retrying...', retryCount, 'attempts left');
                        setTimeout(() => {
                            doSync(retryCount - 1);
                        }, 2000 * (4 - retryCount));
                    } else {
                        logError('Sync failed after all retries:', err);
                        isSyncInProgress = false;
                        forceSyncPending = false;
                        
                        if (syncQueue.length > 0) {
                            const next = syncQueue.shift();
                            syncToGistWithRetry(next.showNotify, next.maxRetries);
                        }
                    }
                });
        };
        
        doSync(maxRetries);
    }

    // ============== ГЕНЕРАЦИЯ ХЕША ==============
    function generateHash(movie, season, episode) {
        if (!movie) return null;
        
        try {
            if (movie.original_name) {
                const s = season || 1;
                const e = episode || 1;
                const hashString = [s, s > 10 ? ':' : '', e, movie.original_name].join('');
                return Lampa.Utils.hash(hashString);
            } else if (movie.original_title) {
                return Lampa.Utils.hash(movie.original_title);
            } else if (movie.title) {
                return Lampa.Utils.hash(movie.title);
            }
        } catch(e) {
            logError('Hash generation error:', e);
        }
        return null;
    }

    // ============== ОПРЕДЕЛЕНИЕ ТИПА КОНТЕНТА ==============
    function isTVShow(movie) {
        return movie && (movie.original_name || movie.number_of_seasons);
    }

    function getSeasonsCount(movie) {
        if (movie.number_of_seasons) return parseInt(movie.number_of_seasons);
        if (movie.seasons && Array.isArray(movie.seasons)) return movie.seasons.length;
        return 1;
    }

    function getEpisodesCount(movie, season) {
        if (movie.seasons && Array.isArray(movie.seasons)) {
            const s = movie.seasons.find(s => s.season_number === parseInt(season));
            if (s && s.episode_count) return parseInt(s.episode_count);
        }
        if (movie.episodes_count) return parseInt(movie.episodes_count);
        return 24;
    }

    function isSeriesFullyWatched(movie, timelines) {
        if (!movie || !isTVShow(movie)) return false;
        
        const seasons = getSeasonsCount(movie);
        let totalWatched = 0;
        let totalEpisodes = 0;
        
        for (let s = 1; s <= seasons; s++) {
            const episodes = getEpisodesCount(movie, s);
            totalEpisodes += episodes;
            
            for (let e = 1; e <= episodes; e++) {
                const hash = generateHash(movie, s, e);
                if (hash && timelines[hash] && timelines[hash].percent >= 90) {
                    totalWatched++;
                }
            }
        }
        
        return totalEpisodes > 0 && (totalWatched / totalEpisodes) >= 0.95;
    }

    // ============== ОЧИСТКА ЛОКАЛЬНЫХ ТАЙМЛАЙНОВ ==============
    function cleanLocalTimelines(options) {
        const result = {
            removed: 0,
            errors: 0,
            details: []
        };
        
        const keys = getAllTimelineKeys();
        const now = Date.now();
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                let changed = false;
                
                for (const hash in data) {
                    const item = data[hash];
                    let shouldRemove = false;
                    let reason = '';
                    
                    if (options.percentThreshold !== undefined && options.percentThreshold > 0) {
                        if (item.percent >= options.percentThreshold) {
                            shouldRemove = true;
                            reason = 'percent >= ' + options.percentThreshold;
                        }
                    }
                    
                    if (!shouldRemove && options.daysThreshold !== undefined && options.daysThreshold > 0) {
                        const itemTime = item.updated || item.timestamp || 0;
                        const daysPassed = (now - itemTime) / (1000 * 60 * 60 * 24);
                        if (daysPassed >= options.daysThreshold) {
                            shouldRemove = true;
                            reason = 'days >= ' + options.daysThreshold;
                        }
                    }
                    
                    if (shouldRemove) {
                        delete data[hash];
                        changed = true;
                        result.removed++;
                        result.details.push({ hash, reason });
                    }
                }
                
                if (changed) {
                    Lampa.Storage.set(key, data);
                }
            } catch(e) {
                logError('Error cleaning', key, ':', e);
                result.errors++;
            }
        });
        
        log('Clean local timelines:', result);
        return result;
    }

    // ============== ФИЛЬТРАЦИЯ ТАЙМЛАЙНОВ ДЛЯ GIST ==============
    function filterTimelinesForGist(timelines, options) {
        if (!options || !options.enabled) return timelines;
        
        const filtered = {};
        const now = Date.now();
        
        const sorted = Object.keys(timelines)
            .map(h => ({ hash: h, updated: timelines[h].updatedAt || 0 }))
            .sort((a, b) => b.updated - a.updated);
        
        for (const hash in timelines) {
            const item = timelines[hash];
            let shouldKeep = true;
            
            if (options.maxCount !== undefined && options.maxCount > 0) {
                const index = sorted.findIndex(s => s.hash === hash);
                if (index >= options.maxCount) {
                    shouldKeep = false;
                }
            }
            
            if (shouldKeep && options.percentThreshold !== undefined && options.percentThreshold > 0) {
                if (item.percent >= options.percentThreshold) {
                    shouldKeep = false;
                }
            }
            
            if (shouldKeep && options.daysThreshold !== undefined && options.daysThreshold > 0) {
                const itemTime = item.updatedAt || 0;
                const daysPassed = (now - itemTime) / (1000 * 60 * 60 * 24);
                if (daysPassed >= options.daysThreshold) {
                    shouldKeep = false;
                }
            }
            
            if (shouldKeep) {
                filtered[hash] = item;
            }
        }
        
        log('Filtered timelines:', Object.keys(timelines).length, '->', Object.keys(filtered).length);
        return filtered;
    }

    // ============== ОЧИСТКА ТАЙМЛАЙНОВ В GIST ==============
    function cleanGistTimelines(options) {
        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) {
            notify('⚠️ GitHub Gist не настроен');
            return false;
        }
        
        log('Cleaning Gist timelines with options:', options);
        
        return fetch(GIST_API + '/' + cfg.gistId, {
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json'
            }
        })
        .then(response => {
            if (!response.ok) throw { status: response.status };
            return response.json();
        })
        .then(data => {
            const content = data.files && data.files['timeline.json'] ? data.files['timeline.json'].content : null;
            if (!content) {
                notify('⚠️ Файл timeline.json не найден');
                return false;
            }
            
            const remote = JSON.parse(content);
            const timelines = remote.timelines || {};
            const originalCount = Object.keys(timelines).length;
            
            const filtered = filterTimelinesForGist(timelines, options);
            const newCount = Object.keys(filtered).length;
            
            if (originalCount === newCount) {
                notify('✅ Ничего не нужно удалять');
                return true;
            }
            
            const newData = {
                description: 'Lampa Timeline Sync',
                public: false,
                files: {
                    'timeline.json': {
                        content: JSON.stringify({
                            version: 2,
                            profile: getProfileId() || 'default',
                            updated: new Date().toISOString(),
                            count: newCount,
                            timelines: filtered
                        }, null, 2)
                    }
                }
            };
            
            return fetch(GIST_API + '/' + cfg.gistId, {
                method: 'PATCH',
                headers: {
                    'Authorization': 'token ' + cfg.token,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(newData)
            })
            .then(response => {
                if (!response.ok) throw { status: response.status };
                return response.json();
            })
            .then(() => {
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                notify('🧹 Удалено ' + (originalCount - newCount) + ' таймлайнов из Gist');
                log('Gist cleaned:', originalCount, '->', newCount);
                return true;
            });
        })
        .catch(err => {
            logError('Clean Gist error:', err);
            notify('❌ Ошибка очистки Gist: ' + (err.status || 'unknown'));
            return false;
        });
    }

    // ============== ОЧИСТКА ВСЕХ ЛОКАЛЬНЫХ ДАННЫХ ==============
    function cleanAllLocalTimelines() {
        const result = {
            removed: 0,
            keys: []
        };
        
        const keys = getAllTimelineKeys();
        
        keys.forEach(key => {
            try {
                Lampa.Storage.set(key, {});
                result.removed++;
                result.keys.push(key);
                log('Cleared:', key);
            } catch(e) {
                logError('Error clearing', key, ':', e);
            }
        });
        
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
        
        notify('🧹 Очищено ' + result.removed + ' хранилищ таймлайнов');
        return result;
    }

    // ============== ХРАНИЛИЩЕ КОНФИГА ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            enabled: true,
            autoSync: true,
            cleanEnabled: false,
            cleanMaxCount: 0,
            cleanPercentThreshold: 0,
            cleanDaysThreshold: 0
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== РАБОТА С GIST ==============
    function syncToGist(showNotify = true) {
        return new Promise((resolve, reject) => {
            const cfg = getConfig();
            if (!cfg.token || !cfg.gistId) {
                if (showNotify) notify('⚠️ GitHub Gist не настроен');
                reject(new Error('Gist not configured'));
                return;
            }

            cleanupOldData();

            let timelines = getAllTimelines();
            const count = Object.keys(timelines).length;
            
            if (count === 0) {
                if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
                resolve(false);
                return;
            }

            if (cfg.cleanEnabled) {
                timelines = filterTimelinesForGist(timelines, {
                    maxCount: cfg.cleanMaxCount || 0,
                    percentThreshold: cfg.cleanPercentThreshold || 0,
                    daysThreshold: cfg.cleanDaysThreshold || 0
                });
            }

            const filteredCount = Object.keys(timelines).length;
            log('SYNC TO GIST:', count, 'timelines, filtered:', filteredCount);

            const data = {
                description: 'Lampa Timeline Sync',
                public: false,
                files: {
                    'timeline.json': {
                        content: JSON.stringify({
                            version: 2,
                            profile: getProfileId() || 'default',
                            updated: new Date().toISOString(),
                            count: filteredCount,
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
                if (response.status === 409) {
                    log('Conflict detected, fetching latest version...');
                    return fetch(url, {
                        headers: {
                            'Authorization': 'token ' + cfg.token,
                            'Accept': 'application/vnd.github.v3+json'
                        }
                    })
                    .then(r => r.json())
                    .then(latestData => {
                        const latestContent = latestData.files && latestData.files['timeline.json'] ? latestData.files['timeline.json'].content : null;
                        if (latestContent) {
                            const latest = JSON.parse(latestContent);
                            const latestTimelines = latest.timelines || {};
                            
                            const merged = { ...latestTimelines };
                            for (const hash in timelines) {
                                if (!merged[hash] || merged[hash].updatedAt < timelines[hash].updatedAt) {
                                    merged[hash] = timelines[hash];
                                }
                            }
                            
                            const mergedCount = Object.keys(merged).length;
                            log('Merged timelines:', mergedCount);
                            
                            const mergedData = {
                                description: 'Lampa Timeline Sync',
                                public: false,
                                files: {
                                    'timeline.json': {
                                        content: JSON.stringify({
                                            version: 2,
                                            profile: getProfileId() || 'default',
                                            updated: new Date().toISOString(),
                                            count: mergedCount,
                                            timelines: merged
                                        }, null, 2)
                                    }
                                }
                            };
                            
                            return fetch(url, {
                                method: 'PATCH',
                                headers: {
                                    'Authorization': 'token ' + cfg.token,
                                    'Accept': 'application/vnd.github.v3+json',
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(mergedData)
                            });
                        }
                        throw new Error('Failed to resolve conflict');
                    });
                }
                if (!response.ok) {
                    throw { status: response.status, statusText: response.statusText };
                }
                return response.json();
            })
            .then(function(response) {
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                if (showNotify) {
                    if (filteredCount < count) {
                        notify('✅ Синхронизировано ' + filteredCount + ' из ' + count + ' таймлайнов (фильтрация)');
                    } else {
                        notify('✅ Синхронизировано ' + filteredCount + ' таймлайнов');
                    }
                }
                log('Sync complete');
                resolve(true);
            })
            .catch(function(err) {
                logError('Sync error:', err.status || 'unknown');
                if (err.status === 404) {
                    createNewGist(showNotify);
                } else {
                    if (showNotify) notify('❌ Ошибка синхронизации: ' + (err.status || 'unknown'));
                }
                reject(err);
            });
        });
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
        return new Promise((resolve, reject) => {
            const cfg = getConfig();
            if (!cfg.token || !cfg.gistId) {
                if (showNotify) notify('⚠️ GitHub Gist не настроен');
                reject(new Error('Gist not configured'));
                return;
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
                        resolve(false);
                        return;
                    }

                    const remote = JSON.parse(content);
                    const remoteTimelines = remote.timelines || {};
                    
                    log('Gist has', Object.keys(remoteTimelines).length, 'timelines');
                    
                    if (Object.keys(remoteTimelines).length === 0) {
                        if (showNotify) notify('⚠️ В Gist нет таймлайнов');
                        resolve(false);
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
                        
                        if (applyImmediately) {
                            const activity = Lampa.Activity.active();
                            const movie = activity?.movie;
                            if (movie) {
                                const hash = generateHash(movie);
                                if (hash && merged[hash]) {
                                    forceApplyTimeline(hash, merged[hash]);
                                }
                            }
                        }
                        
                        if (showNotify) notify('📥 Загружено ' + changes + ' таймлайнов');
                    } else {
                        // Проверяем есть ли расхождения в данных
                        let hasDifferences = false;
                        for (const hash in remoteTimelines) {
                            if (localTimelines[hash] && localTimelines[hash].percent !== remoteTimelines[hash].percent) {
                                hasDifferences = true;
                                break;
                            }
                        }
                        if (hasDifferences) {
                            log('Data differences detected, applying from Gist');
                            saveTimelinesToAllStorages(remoteTimelines);
                            if (applyImmediately) {
                                const activity = Lampa.Activity.active();
                                const movie = activity?.movie;
                                if (movie) {
                                    const hash = generateHash(movie);
                                    if (hash && remoteTimelines[hash]) {
                                        forceApplyTimeline(hash, remoteTimelines[hash]);
                                    }
                                }
                            }
                            if (showNotify) notify('📥 Применены данные из Gist');
                        } else {
                            if (showNotify) notify('✅ Данные актуальны');
                        }
                    }

                    cfg.lastSync = Date.now();
                    saveConfig(cfg);
                    resolve(true);

                } catch(e) {
                    logError('Parse error:', e);
                    if (showNotify) notify('❌ Ошибка чтения данных');
                    reject(e);
                }
            })
            .catch(function(err) {
                logError('Load error:', err.status || 'unknown');
                if (err.status === 404) {
                    if (showNotify) notify('❌ Gist не найден (404)');
                } else {
                    if (showNotify) notify('❌ Ошибка загрузки: ' + (err.status || 'unknown'));
                }
                reject(err);
            });
        });
    }

    // ============== СОБЫТИЯ ПЛЕЕРА ==============
    var syncTimer = null;
    var currentTimeline = null;
    var isSyncing = false;
    var lastSavedTimeline = null;
    var endDetected = false;

    function scheduleSync() {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !isSyncInProgress) {
                syncToGistWithRetry(false, 3);
            }
        }, SAVE_DELAY);
    }

    function handleTimelineUpdate(data) {
        if (!data || !data.hash) return;
        
        const activity = Lampa.Activity.active();
        const movie = activity?.movie;
        if (!movie) return;
        
        const hash = generateHash(movie);
        if (!hash || hash !== data.hash) return;
        
        const time = data.time || 0;
        const duration = data.duration || 0;
        const percent = data.percent || 0;
        
        const isEnd = percent >= 95 || (duration > 0 && time >= duration - 5);
        
        if (isEnd && !endDetected) {
            endDetected = true;
            log('END DETECTED for', hash, 'percent:', percent);
            saveTimelineToFileView(hash, Math.min(time, duration), duration, Math.min(percent, 100), true);
            return;
        }
        
        if (time > 0 && (time !== currentTimeline?.time || Math.abs(time - currentTimeline.time) > 5)) {
            currentTimeline = { time, duration, percent };
            lastSavedTimeline = { hash, time, duration, percent };
            saveTimelineToFileView(hash, time, duration, percent, false);
        }
    }

    function initPlayerListeners() {
        Lampa.Listener.follow('timeline', function(e) {
            if (e.type === 'update') {
                handleTimelineUpdate(e.data);
            }
        });

        Lampa.Player.listener.follow('timeupdate', function(e) {
            const playData = Lampa.Player.playdata();
            if (playData && playData.timeline) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                if (movie) {
                    const hash = generateHash(movie);
                    if (hash) {
                        const time = playData.timeline.time || 0;
                        const duration = playData.timeline.duration || 0;
                        const percent = playData.timeline.percent || 0;
                        
                        if (percent < 90) {
                            endDetected = false;
                        }
                        
                        if (time > 0 && (time !== currentTimeline?.time || Math.abs(time - currentTimeline.time) > 5)) {
                            currentTimeline = { time, duration, percent };
                            lastSavedTimeline = { hash, time, duration, percent };
                            saveTimelineToFileView(hash, time, duration, percent, false);
                        }
                    }
                }
            }
            scheduleSync();
        });

        Lampa.Player.listener.follow('pause', function(e) {
            log('Player paused, syncing...');
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && !isSyncInProgress) {
                const playData = Lampa.Player.playdata();
                if (playData && playData.timeline) {
                    const activity = Lampa.Activity.active();
                    const movie = activity?.movie;
                    if (movie) {
                        const hash = generateHash(movie);
                        if (hash) {
                            const time = playData.timeline.time || 0;
                            const duration = playData.timeline.duration || 0;
                            const percent = playData.timeline.percent || 0;
                            if (time > 0) {
                                saveTimelineToFileView(hash, time, duration, percent, true);
                            }
                        }
                    }
                }
                if (!lastSavedTimeline) {
                    syncToGistWithRetry(false, 3);
                }
            }
        });

        Lampa.Player.listener.follow('destroy', function() {
            log('Player destroyed, syncing...');
            clearTimeout(syncTimer);
            
            const playData = Lampa.Player.playdata();
            if (playData && playData.timeline) {
                const activity = Lampa.Activity.active();
                const movie = activity?.movie;
                if (movie) {
                    const hash = generateHash(movie);
                    if (hash) {
                        const time = playData.timeline.time || 0;
                        const duration = playData.timeline.duration || 0;
                        const percent = playData.timeline.percent || 0;
                        
                        if (time > 0) {
                            const isEnd = percent >= 95 || (duration > 0 && time >= duration - 5);
                            saveTimelineToFileView(hash, Math.min(time, duration), duration, Math.min(percent, 100), true);
                        }
                    }
                }
            }
            
            setTimeout(function() {
                const cfg = getConfig();
                if (cfg.token && cfg.gistId && !isSyncInProgress) {
                    syncToGistWithRetry(false, 3);
                }
                currentTimeline = null;
                lastSavedTimeline = null;
                endDetected = false;
            }, 1000);
        });

        log('Player listeners initialized');
    }

    // ============== ОБРАБОТКА ПРИ ОТКРЫТИИ ФИЛЬМА ==============
    function initActivityListeners() {
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'open') {
                const data = e.data;
                const movie = data?.movie;
                
                if (movie) {
                    const hash = generateHash(movie);
                    if (hash) {
                        log('FULL OPEN:', movie.title || movie.original_title, 'hash:', hash);
                        endDetected = false;
                        
                        const cfg = getConfig();
                        if (cfg.token && cfg.gistId) {
                            syncFromGist(false, true)
                                .then(() => {
                                    const keys = getAllTimelineKeys();
                                    let localUpdated = 0;
                                    let localData = null;
                                    
                                    keys.forEach(function(key) {
                                        try {
                                            const storage = Lampa.Storage.get(key, {});
                                            const item = storage[hash];
                                            if (item && item.updated > localUpdated) {
                                                localUpdated = item.updated;
                                                localData = item;
                                            }
                                        } catch(e) {}
                                    });
                                    
                                    if (localData && localData.percent > 0) {
                                        log('Applying local data for', hash);
                                        forceApplyTimeline(hash, {
                                            time: localData.time,
                                            duration: localData.duration || 0,
                                            percent: localData.percent || 0,
                                            updatedAt: localUpdated
                                        });
                                        
                                        currentTimeline = {
                                            time: localData.time,
                                            duration: localData.duration || 0,
                                            percent: localData.percent || 0
                                        };
                                    }
                                })
                                .catch(() => {
                                    const keys = getAllTimelineKeys();
                                    let localUpdated = 0;
                                    let localData = null;
                                    
                                    keys.forEach(function(key) {
                                        try {
                                            const storage = Lampa.Storage.get(key, {});
                                            const item = storage[hash];
                                            if (item && item.updated > localUpdated) {
                                                localUpdated = item.updated;
                                                localData = item;
                                            }
                                        } catch(e) {}
                                    });
                                    
                                    if (localData && localData.percent > 0) {
                                        forceApplyTimeline(hash, {
                                            time: localData.time,
                                            duration: localData.duration || 0,
                                            percent: localData.percent || 0,
                                            updatedAt: localUpdated
                                        });
                                    }
                                });
                        }
                    }
                }
            }
        });
        
        log('Activity listeners initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ ПРОВЕРКА ЦЕЛОСТНОСТИ ==============
    function integrityCheck() {
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
                forceUIUpdate(currentHash, mainData[currentHash]);
            }
        }
    }

    function getCurrentHash() {
        const activity = Lampa.Activity.active();
        const movie = activity?.movie;
        if (!movie) return null;
        
        let season = activity?.season || 1;
        let episode = activity?.episode || 1;
        
        if (movie.original_title) {
            return generateHash(movie);
        }
        
        return generateHash(movie, season, episode);
    }

    // ============== ДИАЛОГ ОЧИСТКИ ==============
    function showCleanupDialog() {
        const cfg = getConfig();
        
        const items = [
            { title: '🧹 Локальная очистка (все хранилища)', action: 'local_all' },
            { title: '──────────', separator: true },
            { title: '📊 Очистка Gist по правилам:', action: 'status' },
        ];
        
        if (cfg.cleanEnabled) {
            let info = '✅ Включена';
            if (cfg.cleanMaxCount > 0) info += ', макс: ' + cfg.cleanMaxCount;
            if (cfg.cleanPercentThreshold > 0) info += ', %: ' + cfg.cleanPercentThreshold;
            if (cfg.cleanDaysThreshold > 0) info += ', дней: ' + cfg.cleanDaysThreshold;
            items.push({ title: '   ' + info, action: 'status' });
        } else {
            items.push({ title: '   ❌ Отключена', action: 'status' });
        }
        
        items.push(
            { title: '──────────', separator: true },
            { title: '⚙️ Настройка правил очистки', action: 'settings' },
            { title: '🧹 Применить очистку Gist сейчас', action: 'gist_clean' },
            { title: '──────────', separator: true },
            { title: '❌ Назад', action: 'back' }
        );
        
        Lampa.Select.show({
            title: '🧹 Очистка таймлайнов',
            items: items,
            onSelect: function(item) {
                if (item.action === 'local_all') {
                    Lampa.Select.show({
                        title: '⚠️ Подтверждение',
                        items: [
                            { title: '❌ Отмена', action: 'cancel' },
                            { title: '✅ Да, очистить все локальные таймлайны', action: 'confirm' }
                        ],
                        onSelect: function(confirm) {
                            if (confirm.action === 'confirm') {
                                const result = cleanAllLocalTimelines();
                                notify('🧹 Очищено ' + result.removed + ' хранилищ');
                            }
                            showCleanupDialog();
                        },
                        onBack: function() {
                            showCleanupDialog();
                        }
                    });
                } else if (item.action === 'settings') {
                    showCleanupSettings();
                } else if (item.action === 'gist_clean') {
                    if (!cfg.cleanEnabled) {
                        notify('⚠️ Очистка Gist отключена. Включите в настройках.');
                        showCleanupDialog();
                        return;
                    }
                    
                    Lampa.Select.show({
                        title: '⚠️ Применить очистку Gist?',
                        items: [
                            { title: '❌ Отмена', action: 'cancel' },
                            { title: '✅ Да, очистить Gist', action: 'confirm' }
                        ],
                        onSelect: function(confirm) {
                            if (confirm.action === 'confirm') {
                                Lampa.Loading.start();
                                cleanGistTimelines({
                                    maxCount: cfg.cleanMaxCount || 0,
                                    percentThreshold: cfg.cleanPercentThreshold || 0,
                                    daysThreshold: cfg.cleanDaysThreshold || 0
                                }).then(() => {
                                    Lampa.Loading.stop();
                                });
                            }
                            showCleanupDialog();
                        },
                        onBack: function() {
                            showCleanupDialog();
                        }
                    });
                } else if (item.action === 'back') {
                    showGistSetup();
                }
            },
            onBack: function() {
                showGistSetup();
            }
        });
    }

    // ============== НАСТРОЙКИ ОЧИСТКИ ==============
    function showCleanupSettings() {
        const cfg = getConfig();
        
        const items = [
            { title: '🔄 Автоочистка при синхронизации: ' + (cfg.cleanEnabled ? '✅ Вкл' : '❌ Выкл'), action: 'toggle' },
            { title: '──────────', separator: true },
            { title: '📊 Максимальное количество таймлайнов: ' + (cfg.cleanMaxCount > 0 ? cfg.cleanMaxCount : '∞'), action: 'max_count' },
            { title: '📈 Порог процента просмотра для удаления: ' + (cfg.cleanPercentThreshold > 0 ? cfg.cleanPercentThreshold + '%' : 'Выкл'), action: 'percent' },
            { title: '📅 Количество дней для удаления: ' + (cfg.cleanDaysThreshold > 0 ? cfg.cleanDaysThreshold : 'Выкл'), action: 'days' },
            { title: '──────────', separator: true },
            { title: '❌ Назад', action: 'back' }
        ];
        
        Lampa.Select.show({
            title: '⚙️ Настройки очистки',
            items: items,
            onSelect: function(item) {
                const newCfg = getConfig();
                
                if (item.action === 'toggle') {
                    newCfg.cleanEnabled = !newCfg.cleanEnabled;
                    saveConfig(newCfg);
                    notify('Автоочистка ' + (newCfg.cleanEnabled ? 'включена' : 'выключена'));
                    showCleanupSettings();
                } else if (item.action === 'max_count') {
                    Lampa.Input.edit({
                        title: 'Максимальное количество таймлайнов (0 - без ограничений)',
                        value: String(newCfg.cleanMaxCount || 0),
                        nosave: true,
                        layout: 'nums'
                    }, function(val) {
                        if (val !== null) {
                            const num = parseInt(val) || 0;
                            newCfg.cleanMaxCount = num < 0 ? 0 : num;
                            saveConfig(newCfg);
                            notify('Максимум: ' + newCfg.cleanMaxCount);
                        }
                        showCleanupSettings();
                    });
                } else if (item.action === 'percent') {
                    Lampa.Input.edit({
                        title: 'Порог процента просмотра для удаления (0 - выкл, 1-100)',
                        value: String(newCfg.cleanPercentThreshold || 0),
                        nosave: true,
                        layout: 'nums'
                    }, function(val) {
                        if (val !== null) {
                            const num = parseInt(val) || 0;
                            newCfg.cleanPercentThreshold = num < 0 ? 0 : (num > 100 ? 100 : num);
                            saveConfig(newCfg);
                            notify('Порог: ' + newCfg.cleanPercentThreshold + '%');
                        }
                        showCleanupSettings();
                    });
                } else if (item.action === 'days') {
                    Lampa.Input.edit({
                        title: 'Количество дней для удаления (0 - выкл)',
                        value: String(newCfg.cleanDaysThreshold || 0),
                        nosave: true,
                        layout: 'nums'
                    }, function(val) {
                        if (val !== null) {
                            const num = parseInt(val) || 0;
                            newCfg.cleanDaysThreshold = num < 0 ? 0 : num;
                            saveConfig(newCfg);
                            notify('Дней: ' + newCfg.cleanDaysThreshold);
                        }
                        showCleanupSettings();
                    });
                } else if (item.action === 'back') {
                    showCleanupDialog();
                }
            },
            onBack: function() {
                showCleanupDialog();
            }
        });
    }

    // ============== НАСТРОЙКИ ==============
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
                        name: 'Настройка Gist',
                        description: 'GitHub Gist для синхронизации прогресса'
                    },
                    onChange: function() {
                        showGistSetup();
                    }
                });
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
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: [
                { title: '🔑 Токен: ' + (cfg.token ? '✅ Установлен' : '❌ Не установлен'), action: 'token' },
                { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), action: 'id' },
                { title: '👤 Profile ID: ' + profileId, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📊 Таймлайнов: ' + count, action: 'status' },
                { title: '🔄 Последняя синхр.: ' + lastSync, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist (принудительно)', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), action: 'toggle_auto' },
                { title: '──────────', separator: true },
                { title: '🧹 Очистка таймлайнов', action: 'cleanup' },
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
                    Lampa.Loading.start();
                    syncToGistWithRetry(true, 3).then(() => {
                        Lampa.Loading.stop();
                        setTimeout(showGistSetup, 1000);
                    });
                } else if (item.action === 'download') {
                    Lampa.Loading.start();
                    syncFromGist(true, true).then(() => {
                        Lampa.Loading.stop();
                        setTimeout(showGistSetup, 1000);
                    }).catch(() => {
                        Lampa.Loading.stop();
                        setTimeout(showGistSetup, 1000);
                    });
                } else if (item.action === 'toggle_auto') {
                    newCfg.autoSync = !newCfg.autoSync;
                    saveConfig(newCfg);
                    notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                    showGistSetup();
                } else if (item.action === 'cleanup') {
                    showCleanupDialog();
                } else if (item.action === 'status') {
                    showGistSetup();
                } else if (item.action === 'cancel') {
                    // Просто закрываем
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(function() {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !isSyncInProgress) {
                const timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    log('Periodic sync');
                    syncToGistWithRetry(false, 3);
                }
            }
        }, SYNC_INTERVAL);
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadOnStart() {
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(function() {
                syncFromGist(false, true).catch(() => {});
            }, 3000);
        }
        
        setTimeout(function() {
            integrityCheck();
        }, 10000);
        
        setInterval(integrityCheck, 5 * 60 * 1000);
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

        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        log('===== INIT =====');
        log('Profile:', getProfileId() || 'default');
        log('Found', count, 'timelines');
        log('Token:', cfg.token ? '✓' : '✗');
        log('Gist ID:', cfg.gistId ? '✓' : '✗');
        log('Auto sync:', cfg.autoSync ? '✓' : '✗');
        log('Clean enabled:', cfg.cleanEnabled ? '✓' : '✗');
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
        init();
    } else {
        Lampa.Listener.follow('app', function(e) {
            if (e.type === 'ready') {
                init();
            }
        });
    }

})();
