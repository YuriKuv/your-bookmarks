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
        
        // Добавляем все устаревшие nsl_timeline_* ключи
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
            // Новые настройки автоочистки
            autoCleanup: false,
            maxTimelines: 500,
            cleanupPercent: 95,
            cleanupDays: 30
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== НОВЫЕ ФУНКЦИИ ДЛЯ УПРАВЛЕНИЯ ТАЙМЛАЙНАМИ ==============

    /**
     * Очистка локальных таймлайнов из всех хранилищ
     * @param {Object} options - параметры очистки
     * @param {Array} options.excludeHashes - хеши для исключения
     * @param {number} options.maxTimelines - максимальное количество
     * @param {number} options.cleanupPercent - порог процента для удаления
     * @param {number} options.cleanupDays - порог дней для удаления
     * @param {boolean} options.dryRun - только показать что будет удалено
     * @returns {Object} - результат очистки
     */
    function cleanupLocalTimelines(options = {}) {
        const cfg = getConfig();
        
        // Используем значения из конфига если не переданы
        const {
            excludeHashes = [],
            maxTimelines = cfg.maxTimelines || 500,
            cleanupPercent = cfg.cleanupPercent || 95,
            cleanupDays = cfg.cleanupDays || 30,
            dryRun = false
        } = options;

        log('Starting local cleanup', { maxTimelines, cleanupPercent, cleanupDays });

        log('Starting local cleanup', options);
        
        const keys = getAllTimelineKeys();
        const now = Date.now();
        const results = {
            removed: {},
            kept: {},
            total: 0,
            removedCount: 0,
            keptCount: 0
        };

        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                const items = Object.keys(data);
                
                if (items.length === 0) return;
                
                // Собираем таймлайны с их данными
                let timelines = items.map(hash => ({
                    hash: hash,
                    data: data[hash],
                    updated: data[hash].updated || data[hash].timestamp || 0,
                    percent: data[hash].percent || 0,
                    time: data[hash].time || 0,
                    duration: data[hash].duration || 0
                }));
                
                // Сортируем по времени обновления (новые сверху)
                timelines.sort((a, b) => b.updated - a.updated);
                
                const result = { kept: [], removed: [] };
                
                // Фильтруем по процентам
                if (cleanupPercent > 0) {
                    const toRemove = timelines.filter(t => t.percent >= cleanupPercent);
                    toRemove.forEach(t => result.removed.push(t));
                    timelines = timelines.filter(t => t.percent < cleanupPercent);
                }
                
                // Фильтруем по дням
                if (cleanupDays > 0) {
                    const cutoff = now - (cleanupDays * 24 * 60 * 60 * 1000);
                    const toRemove = timelines.filter(t => t.updated < cutoff);
                    toRemove.forEach(t => result.removed.push(t));
                    timelines = timelines.filter(t => t.updated >= cutoff);
                }
                
                // Фильтруем по максимальному количеству
                if (maxTimelines > 0 && timelines.length > maxTimelines) {
                    const toRemove = timelines.slice(maxTimelines);
                    toRemove.forEach(t => result.removed.push(t));
                    timelines = timelines.slice(0, maxTimelines);
                }
                
                // Исключаем указанные хеши
                if (excludeHashes.length > 0) {
                    const toRemove = timelines.filter(t => excludeHashes.includes(t.hash));
                    toRemove.forEach(t => result.removed.push(t));
                    timelines = timelines.filter(t => !excludeHashes.includes(t.hash));
                }
                
                // Удаляем дубликаты в removed
                const removedSet = new Set();
                result.removed = result.removed.filter(t => {
                    if (removedSet.has(t.hash)) return false;
                    removedSet.add(t.hash);
                    return true;
                });
                
                // Сохраняем результат
                result.kept = timelines;
                
                // Обновляем хранилище
                if (!dryRun && result.removed.length > 0) {
                    const newData = {};
                    timelines.forEach(t => {
                        newData[t.hash] = t.data;
                    });
                    Lampa.Storage.set(key, newData);
                    log('Cleaned', result.removed.length, 'items from', key);
                }
                
                results.removed[key] = result.removed;
                results.kept[key] = result.kept;
                results.total += items.length;
                results.removedCount += result.removed.length;
                results.keptCount += result.kept.length;
                
            } catch(e) {
                logError('Cleanup error for', key, ':', e);
            }
        });
        
        // Обновляем Timeline после очистки
        if (!dryRun && results.removedCount > 0) {
            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                Lampa.Timeline.read(true);
            }
            notify('🧹 Очищено ' + results.removedCount + ' таймлайнов');
        }
        
        log('Cleanup complete:', results);
        return results;
    }

    /**
     * Очистка таймлайнов в Gist
     * @param {Object} options - параметры очистки
     * @param {number} options.maxTimelines - максимальное количество
     * @param {number} options.cleanupPercent - порог процента для удаления
     * @param {number} options.cleanupDays - порог дней для удаления
     * @param {boolean} options.dryRun - только показать что будет удалено
     * @returns {Promise<Object>} - результат очистки
     */
    async function cleanupGistTimelines(options = {}) {
        const cfg = getConfig();
        
        const {
            maxTimelines = cfg.maxTimelines || 500,
            cleanupPercent = cfg.cleanupPercent || 95,
            cleanupDays = cfg.cleanupDays || 30,
            dryRun = false
        } = options;

        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) {
            notify('⚠️ GitHub Gist не настроен');
            return null;
        }

        log('Starting Gist cleanup', options);

        try {
            // Загружаем данные из Gist
            const response = await fetch(GIST_API + '/' + cfg.gistId, {
                headers: {
                    'Authorization': 'token ' + cfg.token,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (!response.ok) {
                throw { status: response.status, statusText: response.statusText };
            }

            const data = await response.json();
            const content = data.files && data.files['timeline.json'] ? data.files['timeline.json'].content : null;
            
            if (!content) {
                notify('⚠️ Файл timeline.json не найден');
                return null;
            }

            const remote = JSON.parse(content);
            const timelines = remote.timelines || {};
            const now = Date.now();
            
            if (Object.keys(timelines).length === 0) {
                notify('⚠️ В Gist нет таймлайнов');
                return null;
            }

            // Преобразуем в массив для сортировки
            let timelineArray = Object.keys(timelines).map(hash => ({
                hash: hash,
                ...timelines[hash]
            }));

            // Сортируем по времени обновления (новые сверху)
            timelineArray.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

            const result = { removed: [], kept: [] };

            // Фильтруем по процентам
            if (cleanupPercent > 0) {
                const toRemove = timelineArray.filter(t => t.percent >= cleanupPercent);
                toRemove.forEach(t => result.removed.push(t.hash));
                timelineArray = timelineArray.filter(t => t.percent < cleanupPercent);
            }

            // Фильтруем по дням
            if (cleanupDays > 0) {
                const cutoff = now - (cleanupDays * 24 * 60 * 60 * 1000);
                const toRemove = timelineArray.filter(t => (t.updatedAt || 0) < cutoff);
                toRemove.forEach(t => result.removed.push(t.hash));
                timelineArray = timelineArray.filter(t => (t.updatedAt || 0) >= cutoff);
            }

            // Фильтруем по максимальному количеству
            if (maxTimelines > 0 && timelineArray.length > maxTimelines) {
                const toRemove = timelineArray.slice(maxTimelines);
                toRemove.forEach(t => result.removed.push(t.hash));
                timelineArray = timelineArray.slice(0, maxTimelines);
            }

            // Удаляем дубликаты
            result.removed = [...new Set(result.removed)];

            // Обновляем Gist
            if (!dryRun && result.removed.length > 0) {
                // Создаем новый объект таймлайнов
                const newTimelines = {};
                timelineArray.forEach(t => {
                    newTimelines[t.hash] = {
                        time: t.time,
                        duration: t.duration || 0,
                        percent: t.percent || 0,
                        updatedAt: t.updatedAt || now
                    };
                });

                const updateData = {
                    description: 'Lampa Timeline Sync',
                    public: false,
                    files: {
                        'timeline.json': {
                            content: JSON.stringify({
                                version: remote.version || 2,
                                profile: remote.profile || getProfileId() || 'default',
                                updated: new Date().toISOString(),
                                count: Object.keys(newTimelines).length,
                                timelines: newTimelines
                            }, null, 2)
                        }
                    }
                };

                const updateResponse = await fetch(GIST_API + '/' + cfg.gistId, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': 'token ' + cfg.token,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(updateData)
                });

                if (!updateResponse.ok) {
                    throw { status: updateResponse.status, statusText: updateResponse.statusText };
                }

                cfg.lastSync = Date.now();
                saveConfig(cfg);
                
                notify('🧹 Удалено ' + result.removed.length + ' таймлайнов из Gist');
            } else if (dryRun) {
                notify('📊 Будет удалено: ' + result.removed.length + ' таймлайнов');
            }

            log('Gist cleanup complete:', result);
            return result;

        } catch(err) {
            logError('Gist cleanup error:', err);
            notify('❌ Ошибка очистки Gist: ' + (err.status || 'unknown'));
            return null;
        }
    }

    /**
     * Полная очистка всех таймлайнов (локально + Gist)
     */
    async function fullCleanup(options = {}) {
        const {
            maxTimelines = 500,
            cleanupPercent = 95,
            cleanupDays = 30,
            confirm = true
        } = options;

        if (confirm) {
            const result = await new Promise((resolve) => {
                Lampa.Select.show({
                    title: '🧹 Очистка таймлайнов',
                    items: [
                        { title: '⚠️ Очистить локальные таймлайны', action: 'local' },
                        { title: '⚠️ Очистить таймлайны в Gist', action: 'gist' },
                        { title: '⚠️ Полная очистка (локально + Gist)', action: 'full' },
                        { title: '──────────', separator: true },
                        { title: '❌ Отмена', action: 'cancel' }
                    ],
                    onSelect: function(item) {
                        resolve(item.action);
                    },
                    onBack: function() {
                        resolve('cancel');
                    }
                });
            });

            if (result === 'cancel') return;

            // Параметры очистки
            const cleanupOptions = {
                maxTimelines: maxTimelines,
                cleanupPercent: cleanupPercent,
                cleanupDays: cleanupDays,
                dryRun: false
            };

            if (result === 'local' || result === 'full') {
                cleanupLocalTimelines(cleanupOptions);
            }

            if (result === 'gist' || result === 'full') {
                await cleanupGistTimelines(cleanupOptions);
            }

            if (result === 'full') {
                notify('✅ Полная очистка завершена');
            }
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

        let timelines = getAllTimelines();
        let count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            return false;
        }

        // Автоочистка перед синхронизацией
        if (cfg.autoCleanup) {
            log('Auto cleanup before sync');
            const cleanupOptions = {
                maxTimelines: cfg.maxTimelines || 500,
                cleanupPercent: cfg.cleanupPercent || 95,
                cleanupDays: cfg.cleanupDays || 30,
                dryRun: false
            };
            
            // Очищаем локально
            const localResult = cleanupLocalTimelines(cleanupOptions);
            
            // Обновляем данные после очистки
            timelines = getAllTimelines();
            count = Object.keys(timelines).length;
            
            if (count === 0) {
                if (showNotify) notify('⚠️ Все таймлайны были очищены');
                return false;
            }
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
    var lastSyncTime = 0;

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
                // Основная настройка
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

                // Настройки автоочистки - используем toggle вместо input
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_cleanup_header',
                        type: 'title'
                    },
                    field: {
                        name: '🧹 Автоочистка таймлайнов'
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_auto_cleanup',
                        type: 'toggle',
                        default: false
                    },
                    field: {
                        name: 'Включить автоочистку',
                        description: 'Автоматически удалять старые таймлайны'
                    },
                    onChange: function(value) {
                        const cfg = getConfig();
                        cfg.autoCleanup = value === 'true' || value === true;
                        saveConfig(cfg);
                    }
                });

                // Для числовых параметров используем select с предустановленными значениями
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_max_count',
                        type: 'select',
                        values: {
                            '100': '100',
                            '200': '200',
                            '500': '500',
                            '1000': '1000',
                            '2000': '2000',
                            '5000': '5000'
                        },
                        default: '500'
                    },
                    field: {
                        name: 'Максимальное количество',
                        description: 'Оставлять не более N последних таймлайнов'
                    },
                    onChange: function(value) {
                        const cfg = getConfig();
                        const num = parseInt(value);
                        if (!isNaN(num) && num > 0) {
                            cfg.maxTimelines = num;
                            saveConfig(cfg);
                        }
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_cleanup_percent',
                        type: 'select',
                        values: {
                            '0': 'Выкл',
                            '50': '50%',
                            '75': '75%',
                            '90': '90%',
                            '95': '95%',
                            '98': '98%',
                            '100': '100%'
                        },
                        default: '95'
                    },
                    field: {
                        name: 'Порог процента',
                        description: 'Удалять таймлайны с просмотром >= N%'
                    },
                    onChange: function(value) {
                        const cfg = getConfig();
                        const num = parseInt(value);
                        if (!isNaN(num) && num >= 0 && num <= 100) {
                            cfg.cleanupPercent = num;
                            saveConfig(cfg);
                        }
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_cleanup_days',
                        type: 'select',
                        values: {
                            '0': 'Выкл',
                            '7': '7 дней',
                            '14': '14 дней',
                            '30': '30 дней',
                            '60': '60 дней',
                            '90': '90 дней',
                            '180': '180 дней',
                            '365': '365 дней'
                        },
                        default: '30'
                    },
                    field: {
                        name: 'Количество дней',
                        description: 'Удалять таймлайны старше N дней'
                    },
                    onChange: function(value) {
                        const cfg = getConfig();
                        const num = parseInt(value);
                        if (!isNaN(num) && num >= 0) {
                            cfg.cleanupDays = num;
                            saveConfig(cfg);
                        }
                    }
                });

                // Кнопки очистки
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_cleanup_local',
                        type: 'button'
                    },
                    field: {
                        name: '🧹 Очистить локальные таймлайны',
                        description: 'Удалить таймлайны из локального хранилища'
                    },
                    onChange: function() {
                        showCleanupDialog('local');
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_cleanup_gist',
                        type: 'button'
                    },
                    field: {
                        name: '🧹 Очистить таймлайны в Gist',
                        description: 'Удалить таймлайны из Gist по правилам'
                    },
                    onChange: function() {
                        showCleanupDialog('gist');
                    }
                });

                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: {
                        name: 'timeline_cleanup_full',
                        type: 'button'
                    },
                    field: {
                        name: '🗑️ Полная очистка',
                        description: 'Очистить локально + Gist'
                    },
                    onChange: function() {
                        showCleanupDialog('full');
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
    function showCleanupDialog(mode) {
        const cfg = getConfig();
        
        const items = [
            { title: '📊 Параметры очистки:', action: 'info', disabled: true },
            { title: '   Максимум: ' + cfg.maxTimelines, action: 'info', disabled: true },
            { title: '   Процент: ' + cfg.cleanupPercent + '%', action: 'info', disabled: true },
            { title: '   Дней: ' + cfg.cleanupDays, action: 'info', disabled: true },
            { title: '──────────', separator: true },
        ];

        if (mode === 'local' || mode === 'full') {
            items.push({ title: '🗑️ Очистить локально', action: 'local_confirm' });
        }
        if (mode === 'gist' || mode === 'full') {
            items.push({ title: '🗑️ Очистить Gist', action: 'gist_confirm' });
        }
        if (mode === 'full') {
            items.push({ title: '🗑️ Полная очистка', action: 'full_confirm' });
        }
        items.push({ title: '──────────', separator: true });
        items.push({ title: '❌ Отмена', action: 'cancel' });

        Lampa.Select.show({
            title: '🧹 Очистка таймлайнов',
            items: items,
            onSelect: function(item) {
                if (item.action === 'cancel') return;
                
                const cleanupOptions = {
                    maxTimelines: cfg.maxTimelines || 500,
                    cleanupPercent: cfg.cleanupPercent || 95,
                    cleanupDays: cfg.cleanupDays || 30,
                    dryRun: false
                };

                if (item.action === 'local_confirm') {
                    cleanupLocalTimelines(cleanupOptions);
                } else if (item.action === 'gist_confirm') {
                    cleanupGistTimelines(cleanupOptions);
                } else if (item.action === 'full_confirm') {
                    cleanupLocalTimelines(cleanupOptions);
                    setTimeout(() => {
                        cleanupGistTimelines(cleanupOptions);
                    }, 1000);
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('settings_component');
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
            { title: '🧹 Автоочистка: ' + (cfg.autoCleanup ? '✅ Вкл' : '❌ Выкл'), action: 'toggle_cleanup' },
            { title: '──────────', separator: true },
            { title: '📊 Параметры очистки:', action: 'cleanup_info', disabled: true },
            { title: '   Максимум: ' + cfg.maxTimelines, action: 'cleanup_info', disabled: true },
            { title: '   Процент: ' + cfg.cleanupPercent + '%', action: 'cleanup_info', disabled: true },
            { title: '   Дней: ' + cfg.cleanupDays, action: 'cleanup_info', disabled: true },
            { title: '──────────', separator: true },
            { title: '🧹 Очистить локально', action: 'cleanup_local' },
            { title: '🧹 Очистить Gist', action: 'cleanup_gist' },
            { title: '🗑️ Полная очистка', action: 'cleanup_full' },
            { title: '──────────', separator: true },
            { title: '🧹 Очистить старые ключи', action: 'cleanup_keys' },
            { title: '──────────', separator: true },
            { title: '❌ Закрыть', action: 'cancel' }
        ];

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
                } else if (item.action === 'toggle_cleanup') {
                    newCfg.autoCleanup = !newCfg.autoCleanup;
                    saveConfig(newCfg);
                    notify('Автоочистка ' + (newCfg.autoCleanup ? 'включена' : 'выключена'));
                    showGistSetup();
                } else if (item.action === 'cleanup_local') {
                    showCleanupDialog('local');
                } else if (item.action === 'cleanup_gist') {
                    showCleanupDialog('gist');
                } else if (item.action === 'cleanup_full') {
                    showCleanupDialog('full');
                } else if (item.action === 'cleanup_keys') {
                    const cleaned = cleanupOldData();
                    notify('🧹 Очищено ' + cleaned + ' старых ключей');
                    setTimeout(function() {
                        showGistSetup();
                    }, 1000);
                } else if (item.action === 'status' || item.action === 'cleanup_info') {
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

        // Автоочистка при старте
        if (cfg.autoCleanup) {
            setTimeout(function() {
                log('Auto cleanup on start');
                const cleanupOptions = {
                    maxTimelines: cfg.maxTimelines || 500,
                    cleanupPercent: cfg.cleanupPercent || 95,
                    cleanupDays: cfg.cleanupDays || 30,
                    dryRun: false
                };
                cleanupLocalTimelines(cleanupOptions);
            }, 5000);
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

        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        log('===== INIT =====');
        log('Profile:', getProfileId() || 'default');
        log('Found', count, 'timelines');
        log('Token:', cfg.token ? '✓' : '✗');
        log('Gist ID:', cfg.gistId ? '✓' : '✗');
        log('Auto sync:', cfg.autoSync ? '✓' : '✗');
        log('Auto cleanup:', cfg.autoCleanup ? '✓' : '✗');
        log('Max timelines:', cfg.maxTimelines);
        log('Cleanup percent:', cfg.cleanupPercent + '%');
        log('Cleanup days:', cfg.cleanupDays);
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
