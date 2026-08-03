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

    // ============== ИЗВЛЕЧЕНИЕ ID СЕРИАЛА ИЗ ХЕША ==============
    function extractSerialId(hash, timelineData) {
        // Пытаемся извлечь оригинальное название из хеша
        // В Lampa хеш формируется как: hash([season, season > 10 ? ':' : '', episode, original_name].join(''))
        // Или для фильмов: hash(original_title)
        
        // Пытаемся определить по данным из таймлайна
        if (timelineData && timelineData.original_name) {
            return timelineData.original_name;
        }
        
        // Если нет данных, пытаемся извлечь из хеша
        // Это не идеально, но лучше чем ничего
        return hash;
    }

    // ============== ГРУППИРОВКА ТАЙМЛАЙНОВ ПО СЕРИАЛАМ ==============
    function groupTimelinesBySerial(timelines) {
        const groups = {};
        const movies = {};
        
        for (const hash in timelines) {
            const data = timelines[hash];
            // Определяем по наличию season/episode в данных или по структуре хеша
            // В Lampa хеши сериалов обычно содержат цифры перед названием
            const isSerial = /^\d+[:]?\d+/.test(hash) || (data.season !== undefined && data.episode !== undefined);
            
            if (isSerial) {
                // Извлекаем название сериала из хеша
                let serialName = hash.replace(/^\d+[:]?\d+/, '').trim();
                if (!serialName) {
                    // Если не удалось извлечь, используем весь хеш
                    serialName = hash;
                }
                
                if (!groups[serialName]) {
                    groups[serialName] = {
                        episodes: [],
                        totalPercent: 0,
                        totalEpisodes: 0,
                        watchedEpisodes: 0,
                        updatedAt: 0
                    };
                }
                
                groups[serialName].episodes.push({
                    hash: hash,
                    time: data.time,
                    duration: data.duration || 0,
                    percent: data.percent || 0,
                    updatedAt: data.updatedAt || 0
                });
                
                if (data.updatedAt > groups[serialName].updatedAt) {
                    groups[serialName].updatedAt = data.updatedAt;
                }
            } else {
                movies[hash] = data;
            }
        }
        
        // Вычисляем статистику по каждому сериалу
        for (const serialName in groups) {
            const group = groups[serialName];
            group.totalEpisodes = group.episodes.length;
            group.watchedEpisodes = group.episodes.filter(e => e.percent >= 95).length;
            group.totalPercent = group.episodes.reduce((sum, e) => sum + e.percent, 0) / group.totalEpisodes;
        }
        
        return { groups, movies };
    }

    // ============== ФИЛЬТРАЦИЯ ТАЙМЛАЙНОВ ДЛЯ ОЧИСТКИ ==============
    function filterTimelinesForCleanup(timelines, rules) {
        const now = Date.now();
        const result = { ...timelines };
        let removed = 0;
        let removedSerials = [];
        let removedMovies = [];
        
        // Группируем таймлайны
        const { groups, movies } = groupTimelinesBySerial(result);
        
        // Проверяем правила для сериалов
        const serialsToRemove = [];
        
        for (const serialName in groups) {
            const group = groups[serialName];
            let shouldRemove = false;
            let reason = '';
            
            // Правило 1: По порогу просмотра (удаляем только если ВЕСЬ сериал просмотрен)
            if (rules.maxPercent > 0 && rules.maxPercent < 100) {
                // Удаляем сериал только если все серии просмотрены до порога
                if (group.totalPercent >= rules.maxPercent && group.watchedEpisodes === group.totalEpisodes) {
                    shouldRemove = true;
                    reason = 'Все серии просмотрены (' + Math.round(group.totalPercent) + '%)';
                }
            }
            
            // Правило 2: По количеству дней (удаляем только если сериал не обновлялся)
            if (!shouldRemove && rules.maxDays > 0) {
                const cutoff = now - (rules.maxDays * 24 * 60 * 60 * 1000);
                if (group.updatedAt < cutoff) {
                    // Удаляем только если все серии просмотрены или сериал очень старый
                    if (group.watchedEpisodes === group.totalEpisodes || group.totalPercent >= 90) {
                        shouldRemove = true;
                        reason = 'Не обновлялся ' + rules.maxDays + ' дней, просмотрен';
                    }
                }
            }
            
            if (shouldRemove) {
                serialsToRemove.push({
                    name: serialName,
                    episodes: group.episodes,
                    reason: reason
                });
            }
        }
        
        // Удаляем сериалы целиком
        serialsToRemove.forEach(serial => {
            serial.episodes.forEach(ep => {
                delete result[ep.hash];
                removed++;
            });
            removedSerials.push({
                name: serial.name,
                count: serial.episodes.length,
                reason: serial.reason
            });
        });
        
        // Правило 3: По максимальному количеству (для фильмов)
        if (rules.maxCount > 0) {
            const movieList = Object.keys(movies).map(hash => ({
                hash: hash,
                updatedAt: movies[hash].updatedAt || 0,
                percent: movies[hash].percent || 0
            }));
            
            // Сортируем по дате обновления (старые сначала)
            movieList.sort((a, b) => a.updatedAt - b.updatedAt);
            
            // Удаляем фильмы, если их больше maxCount
            const toRemove = movieList.slice(0, Math.max(0, movieList.length - rules.maxCount));
            toRemove.forEach(item => {
                delete result[item.hash];
                removed++;
                removedMovies.push({
                    hash: item.hash,
                    percent: item.percent
                });
            });
        }
        
        // Правило 4: По порогу просмотра для фильмов (отдельно)
        if (rules.maxPercent > 0 && rules.maxPercent < 100) {
            const toRemove = Object.keys(result).filter(hash => {
                // Проверяем что это фильм (не входит в группы сериалов)
                const isInGroup = Object.values(groups).some(g => 
                    g.episodes.some(e => e.hash === hash)
                );
                if (isInGroup) return false;
                
                return (result[hash].percent || 0) >= rules.maxPercent;
            });
            toRemove.forEach(hash => {
                delete result[hash];
                removed++;
                removedMovies.push({
                    hash: hash,
                    percent: result[hash]?.percent || 0
                });
            });
        }
        
        // Логируем результаты очистки
        if (removedSerials.length > 0) {
            log('Removed serials:', removedSerials.length);
            removedSerials.forEach(s => {
                log('  - ' + s.name + ' (' + s.count + ' episodes) - ' + s.reason);
            });
        }
        if (removedMovies.length > 0) {
            log('Removed movies:', removedMovies.length);
        }
        
        return { filtered: result, removed, removedSerials, removedMovies };
    }

    // ============== ОЧИСТКА ЛОКАЛЬНЫХ ТАЙМЛАЙНОВ ==============
    function cleanLocalTimelines(rules) {
        const keys = getAllTimelineKeys();
        let totalRemoved = 0;
        let totalItems = 0;
        let removedSerials = [];
        let removedMovies = [];
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                const count = Object.keys(data).length;
                totalItems += count;
                
                // Применяем правила
                const { filtered, removed, removedSerials: serials, removedMovies: movies } = filterTimelinesForCleanup(data, rules);
                
                if (removed > 0) {
                    Lampa.Storage.set(key, filtered);
                    totalRemoved += removed;
                    removedSerials = removedSerials.concat(serials);
                    removedMovies = removedMovies.concat(movies);
                    log('Cleaned', removed, 'items from', key);
                }
            } catch(e) {
                logError('Error cleaning', key, ':', e);
            }
        });
        
        // Обновляем интерфейс после очистки
        if (totalRemoved > 0 && Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
        
        return { totalRemoved, totalItems, removedSerials, removedMovies };
    }

    // ============== ОЧИСТКА GIST ==============
    function cleanGistTimelines(rules, showNotify = true) {
        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        log('Cleaning Gist with rules:', rules);

        const url = GIST_API + '/' + cfg.gistId;
        
        return fetch(url, {
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
                    return false;
                }

                const remote = JSON.parse(content);
                const timelines = remote.timelines || {};
                const count = Object.keys(timelines).length;
                
                if (count === 0) {
                    if (showNotify) notify('⚠️ В Gist нет таймлайнов');
                    return false;
                }

                // Применяем фильтры
                const { filtered, removed, removedSerials, removedMovies } = filterTimelinesForCleanup(timelines, rules);
                
                if (removed === 0) {
                    if (showNotify) notify('✅ Нет таймлайнов для удаления');
                    return true;
                }

                // Обновляем Gist
                const updateData = {
                    description: 'Lampa Timeline Sync',
                    public: false,
                    files: {
                        'timeline.json': {
                            content: JSON.stringify({
                                version: 2,
                                profile: getProfileId() || 'default',
                                updated: new Date().toISOString(),
                                count: Object.keys(filtered).length,
                                timelines: filtered
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
                    body: JSON.stringify(updateData)
                })
                .then(function(response) {
                    if (!response.ok) {
                        throw { status: response.status, statusText: response.statusText };
                    }
                    cfg.lastSync = Date.now();
                    saveConfig(cfg);
                    
                    let msg = '🧹 Удалено ' + removed + ' таймлайнов';
                    if (removedSerials.length > 0) {
                        msg += ' (сериалов: ' + removedSerials.length + ')';
                    }
                    if (showNotify) notify(msg);
                    
                    log('Gist cleaned:', removed, 'removed');
                    log('Removed serials:', removedSerials.length);
                    log('Removed movies:', removedMovies.length);
                    return true;
                });

            } catch(e) {
                logError('Clean Gist error:', e);
                if (showNotify) notify('❌ Ошибка очистки Gist');
                return false;
            }
        })
        .catch(function(err) {
            logError('Clean Gist fetch error:', err.status || 'unknown');
            if (showNotify) notify('❌ Ошибка загрузки Gist: ' + (err.status || 'unknown'));
            return false;
        });
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
        
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
        
        forceUIUpdate(hash, { time, duration, percent });
        
        scheduleSync();
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

    // ============== ХРАНИЛИЩЕ КОНФИГА ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            enabled: true,
            autoSync: true,
            cleanupEnabled: false,
            cleanupMaxCount: 100,
            cleanupMaxPercent: 100,
            cleanupMaxDays: 30,
            cleanupAutoRun: false
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
        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        cleanupOldData();

        let timelines = getAllTimelines();
        let count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        // Применяем автоочистку перед отправкой если включена
        if (cfg.cleanupEnabled && cfg.cleanupAutoRun) {
            const rules = {
                maxCount: cfg.cleanupMaxCount || 0,
                maxPercent: cfg.cleanupMaxPercent || 0,
                maxDays: cfg.cleanupMaxDays || 0
            };
            const { filtered, removed, removedSerials, removedMovies } = filterTimelinesForCleanup(timelines, rules);
            if (removed > 0) {
                timelines = filtered;
                count = Object.keys(timelines).length;
                log('Auto-cleanup before sync:', removed, 'removed');
                if (removedSerials.length > 0) {
                    log('  - Serials removed:', removedSerials.length);
                }
                if (removedMovies.length > 0) {
                    log('  - Movies removed:', removedMovies.length);
                }
            }
        }

        if (count === 0) {
            if (showNotify) notify('⚠️ Все таймлайны отфильтрованы');
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
        let timelines = getAllTimelines();
        let count = Object.keys(timelines).length;
        
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
        
        const activity = Lampa.Activity.active();
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
                                            forceApplyTimeline(hash, remoteData);
                                            
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

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_header',
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
                        description: 'Автоматически удалять старые таймлайны'
                    },
                    onChange: function(value) {
                        const cfg = getConfig();
                        cfg.cleanupEnabled = value === 'true';
                        saveConfig(cfg);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_auto_run',
                        type: 'toggle',
                        default: false
                    },
                    field: {
                        name: 'Очищать при синхронизации',
                        description: 'Применять правила очистки при каждой отправке в Gist'
                    },
                    onChange: function(value) {
                        const cfg = getConfig();
                        cfg.cleanupAutoRun = value === 'true';
                        saveConfig(cfg);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_max_count',
                        type: 'input',
                        values: '',
                        placeholder: '100',
                        default: '100'
                    },
                    field: {
                        name: 'Максимальное количество фильмов',
                        description: 'Оставлять не более N фильмов (сериалы не ограничиваются)'
                    },
                    onChange: function(value) {
                        const cfg = getConfig();
                        cfg.cleanupMaxCount = parseInt(value) || 0;
                        saveConfig(cfg);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_max_percent',
                        type: 'input',
                        values: '',
                        placeholder: '95',
                        default: '95'
                    },
                    field: {
                        name: 'Порог просмотра %',
                        description: 'Удалять сериалы и фильмы с прогрессом >= N% (0 - без ограничения)'
                    },
                    onChange: function(value) {
                        const cfg = getConfig();
                        cfg.cleanupMaxPercent = parseInt(value) || 0;
                        saveConfig(cfg);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_max_days',
                        type: 'input',
                        values: '',
                        placeholder: '30',
                        default: '30'
                    },
                    field: {
                        name: 'Максимальный возраст (дни)',
                        description: 'Удалять таймлайны старше N дней (0 - без ограничения)'
                    },
                    onChange: function(value) {
                        const cfg = getConfig();
                        cfg.cleanupMaxDays = parseInt(value) || 0;
                        saveConfig(cfg);
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_actions_header',
                        type: 'title'
                    },
                    field: {
                        name: '⚡ Действия'
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_local',
                        type: 'button'
                    },
                    field: {
                        name: '🧹 Очистить локальные таймлайны',
                        description: 'Применить правила очистки к локальным данным'
                    },
                    onChange: function() {
                        showCleanupDialog('local');
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_gist',
                        type: 'button'
                    },
                    field: {
                        name: '🧹 Очистить Gist',
                        description: 'Применить правила очистки к данным в Gist'
                    },
                    onChange: function() {
                        showCleanupDialog('gist');
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'cleanup_all',
                        type: 'button'
                    },
                    field: {
                        name: '🧹 Очистить всё',
                        description: 'Применить правила очистки к локальным данным и Gist'
                    },
                    onChange: function() {
                        showCleanupDialog('all');
                    }
                });
            }

            log('Settings initialized');
        } catch(e) {
            logError('Settings setup error:', e);
            addMenuItem();
        }
    }

    // ============== ДИАЛОГ ОЧИСТКИ ==============
    function showCleanupDialog(target) {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        // Получаем статистику по сериалам
        const { groups } = groupTimelinesBySerial(timelines);
        const serialCount = Object.keys(groups).length;
        const movieCount = count - Object.values(groups).reduce((sum, g) => sum + g.episodes.length, 0);
        
        Lampa.Select.show({
            title: '🧹 Очистка таймлайнов',
            items: [
                { title: '📊 Всего таймлайнов: ' + count, action: 'status' },
                { title: '   📌 Сериалов: ' + serialCount + ' (' + (count - movieCount) + ' эпизодов)', action: 'status' },
                { title: '   📌 Фильмов: ' + movieCount, action: 'status' },
                { title: '──────────', separator: true },
                { title: '📋 Правила очистки:', action: 'status' },
                { title: '   📌 Максимум фильмов: ' + (cfg.cleanupMaxCount || 'без ограничений'), action: 'status' },
                { title: '   📌 Порог %: ' + (cfg.cleanupMaxPercent || 'без ограничений'), action: 'status' },
                { title: '   📌 Дней: ' + (cfg.cleanupMaxDays || 'без ограничений'), action: 'status' },
                { title: '──────────', separator: true },
                { title: '   ℹ️ Сериалы удаляются целиком', action: 'status' },
                { title: '   ℹ️ Только когда все серии просмотрены', action: 'status' },
                { title: '──────────', separator: true },
                { title: '✅ Подтвердить очистку', action: 'confirm' },
                { title: '──────────', separator: true },
                { title: '❌ Отмена', action: 'cancel' }
            ],
            onSelect: function(item) {
                if (item.action === 'confirm') {
                    performCleanup(target);
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    function performCleanup(target) {
        const cfg = getConfig();
        const rules = {
            maxCount: cfg.cleanupMaxCount || 0,
            maxPercent: cfg.cleanupMaxPercent || 0,
            maxDays: cfg.cleanupMaxDays || 0
        };

        Lampa.Loading.start();

        const promises = [];

        if (target === 'local' || target === 'all') {
            promises.push(
                new Promise((resolve) => {
                    setTimeout(() => {
                        const result = cleanLocalTimelines(rules);
                        resolve({ type: 'local', result });
                    }, 100);
                })
            );
        }

        if (target === 'gist' || target === 'all') {
            promises.push(
                new Promise((resolve) => {
                    setTimeout(() => {
                        cleanGistTimelines(rules, false).then((success) => {
                            resolve({ type: 'gist', success });
                        });
                    }, 200);
                })
            );
        }

        Promise.all(promises).then((results) => {
            Lampa.Loading.stop();
            
            let messages = [];
            results.forEach((res) => {
                if (res.type === 'local' && res.result) {
                    let msg = 'Локально: удалено ' + res.result.totalRemoved + ' из ' + res.result.totalItems;
                    if (res.result.removedSerials && res.result.removedSerials.length > 0) {
                        msg += ' (сериалов: ' + res.result.removedSerials.length + ')';
                    }
                    messages.push(msg);
                }
                if (res.type === 'gist') {
                    messages.push('Gist: ' + (res.success ? '✅ очищен' : '❌ ошибка'));
                }
            });
            
            notify('🧹 ' + messages.join(' | '));
            
            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                Lampa.Timeline.read(true);
            }
            
            const currentHash = getCurrentHash();
            if (currentHash) {
                const timelines = getAllTimelines();
                if (timelines[currentHash]) {
                    forceUIUpdate(currentHash, timelines[currentHash]);
                }
            }
        });
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
        
        const items = [
            { title: '🔑 Токен: ' + (cfg.token ? '✅ Установлен' : '❌ Не установлен'), action: 'token' },
            { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), action: 'id' },
            { title: '👤 Profile ID: ' + profileId, action: 'status' },
            { title: '──────────', separator: true },
            { title: '📊 Таймлайнов: ' + count, action: 'status' },
            { title: '🔄 Последняя синхр.: ' + lastSync, action: 'status' },
            { title: '──────────', separator: true },
            { title: '📤 Выгрузить в Gist', action: 'upload' },
            { title: '📥 Загрузить из Gist', action: 'download' },
            { title: '──────────', separator: true },
            { title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), action: 'toggle_auto' },
            { title: '──────────', separator: true },
            { title: '🧹 Очистка таймлайнов', action: 'cleanup_menu' },
            { title: '──────────', separator: true },
            { title: '🧹 Очистить старые ключи', action: 'cleanup_old' },
            { title: '──────────', separator: true },
            { title: '❌ Закрыть', action: 'cancel' }
        ];

        if (cfg.cleanupEnabled) {
            items.splice(5, 0, 
                { title: '──────────', separator: true },
                { title: '🧹 Автоочистка: ✅ Включена', action: 'status' },
                { title: '   📌 Максимум фильмов: ' + (cfg.cleanupMaxCount || '∞'), action: 'status' },
                { title: '   📌 Порог %: ' + (cfg.cleanupMaxPercent || '∞'), action: 'status' },
                { title: '   📌 Дней: ' + (cfg.cleanupMaxDays || '∞'), action: 'status' },
                { title: '   ℹ️ Сериалы удаляются целиком', action: 'status' }
            );
        }

        Lampa.Select.show({
            title: '☁️ GitHub Gist',
            items: items,
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
                } else if (item.action === 'cleanup_menu') {
                    showCleanupDialog('all');
                } else if (item.action === 'cleanup_old') {
                    const cleaned = cleanupOldData();
                    notify('🧹 Очищено ' + cleaned + ' старых ключей');
                    setTimeout(function() {
                        showGistSetup();
                    }, 1000);
                } else if (item.action === 'status') {
                    showGistSetup();
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
        log('Cleanup enabled:', cfg.cleanupEnabled ? '✓' : '✗');
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
