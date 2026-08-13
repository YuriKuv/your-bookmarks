(function() {
    'use strict';

    if (window.timeline_gist_sync_v3) return;
    window.timeline_gist_sync_v3 = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const PLUGIN_NAME = 'TimelineSyncV3';
    const CFG_KEY = 'timeline_gist_config_v3';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 30000; // 30 секунд
    const DEBUG = true;

    // ============== ЛОГГИРОВАНИЕ ==============
    const log = (...args) => DEBUG && console.log(`[${PLUGIN_NAME}]`, ...args);
    const logError = (...args) => console.error(`[${PLUGIN_NAME}] ERROR:`, ...args);

    // ============== КОНФИГ ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            autoSync: true
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== PROFILE ID ==============
    function getProfileId() {
        try {
            const account = Lampa.Storage.get('account', {});
            return String((account.profile || {}).id || '');
        } catch(e) {
            return '';
        }
    }

    // ============== КЛЮЧ ХРАНИЛИЩА ==============
    function getTimelineKey() {
        // Используем ТОЛЬКО file_view как базовый
        // Но также проверяем file_view_{profileId}
        const profileId = getProfileId();
        const profileKey = profileId ? 'file_view_' + profileId : 'file_view';
        
        // Проверяем, какой ключ реально используется
        const baseData = Lampa.Storage.get('file_view', null);
        const profileData = profileId ? Lampa.Storage.get(profileKey, null) : null;
        
        if (profileData && typeof profileData === 'object' && Object.keys(profileData).length > 0) {
            return profileKey;
        }
        
        if (baseData && typeof baseData === 'object' && Object.keys(baseData).length > 0) {
            return 'file_view';
        }
        
        // Если оба пустые, используем профильный
        return profileKey;
    }

    // ============== ХЕШ-ФУНКЦИЯ ==============
    function lampaHash(input) {
        let str = (input || '') + '';
        let hash = 0;
        
        if (str.length === 0) return hash;
        
        for (let i = 0; i < str.length; i++) {
            let char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        return Math.abs(hash) + '';
    }

    function generateHash(movie, season, episode) {
        if (!movie) return null;
        
        try {
            let hashString;
            
            if (movie.original_name) {
                const s = season || 1;
                const e = episode || 1;
                hashString = s + (s > 10 ? ':' : '') + e + movie.original_name;
            } else if (movie.original_title) {
                hashString = movie.original_title;
            } else if (movie.title) {
                hashString = movie.title;
            } else {
                return null;
            }
            
            return lampaHash(hashString);
        } catch(e) {
            logError('Hash error:', e);
            return null;
        }
    }

    // ============== ПОЛУЧЕНИЕ ВСЕХ ТАЙМЛАЙНОВ ==============
    function getAllTimelines() {
        const result = {};
        
        // Проверяем ВСЕ возможные ключи
        const keys = ['file_view'];
        const profileId = getProfileId();
        if (profileId) {
            keys.push('file_view_' + profileId);
        }
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                
                if (typeof data === 'object' && data !== null) {
                    for (const hash in data) {
                        const item = data[hash];
                        if (!item || typeof item === 'number') continue;
                        
                        // Выбираем самый свежий
                        const updated = item.updated || 0;
                        
                        if (!result[hash] || updated > (result[hash].updated || 0)) {
                            result[hash] = {
                                time: Math.round(item.time || 0),
                                duration: Math.round(item.duration || 0),
                                percent: Math.round(item.percent || 0),
                                updated: updated
                            };
                        }
                    }
                }
            } catch(e) {
                logError(`Error reading ${key}:`, e);
            }
        });
        
        return result;
    }

    // ============== СОХРАНЕНИЕ ВО ВСЕ КЛЮЧИ ==============
    function saveToAllKeys(hash, time, duration, percent) {
        const keys = ['file_view'];
        const profileId = getProfileId();
        if (profileId) {
            keys.push('file_view_' + profileId);
        }
        
        keys.forEach(key => {
            try {
                const data = Lampa.Storage.get(key, {});
                data[hash] = {
                    time: Math.round(time),
                    duration: Math.round(duration || 0),
                    percent: Math.round(percent || 0),
                    updated: Date.now()
                };
                Lampa.Storage.set(key, data);
            } catch(e) {
                logError(`Error saving to ${key}:`, e);
            }
        });
    }

    // ============== GIST API ==============
    let syncInProgress = false;

    function syncToGist(showNotify = false) {
        return new Promise((resolve, reject) => {
            const cfg = getConfig();
            
            if (!cfg.token || !cfg.gistId) {
                if (showNotify) notify('⚠️ Gist не настроен');
                resolve(false);
                return;
            }
            
            const timelines = getAllTimelines();
            const count = Object.keys(timelines).length;
            
            if (count === 0) {
                resolve(false);
                return;
            }
            
            log(`Syncing ${count} timelines to Gist...`);
            
            const gistData = {
                description: 'Lampa Timeline Sync',
                public: false,
                files: {
                    'timeline.json': {
                        content: JSON.stringify({
                            updated: new Date().toISOString(),
                            count: count,
                            timelines: timelines
                        }, null, 2)
                    }
                }
            };
            
            fetch(`${GIST_API}/${cfg.gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${cfg.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(gistData)
            })
            .then(response => {
                if (response.status === 404) {
                    return createGist(timelines);
                }
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(() => {
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                if (showNotify) notify(`✅ Синхронизировано ${count} таймлайнов`);
                log('Sync completed');
                resolve(true);
            })
            .catch(err => {
                logError('Sync error:', err);
                if (showNotify) notify('❌ Ошибка синхронизации');
                reject(err);
            });
        });
    }

    function createGist(timelines) {
        const cfg = getConfig();
        const count = Object.keys(timelines).length;
        
        return fetch(GIST_API, {
            method: 'POST',
            headers: {
                'Authorization': `token ${cfg.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                description: 'Lampa Timeline Sync',
                public: false,
                files: {
                    'timeline.json': {
                        content: JSON.stringify({
                            updated: new Date().toISOString(),
                            count: count,
                            timelines: timelines
                        }, null, 2)
                    }
                }
            })
        })
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        })
        .then(data => {
            cfg.gistId = data.id;
            cfg.lastSync = Date.now();
            saveConfig(cfg);
            notify(`✅ Gist создан: ${data.id}`);
            log('Gist created:', data.id);
        });
    }

    // ============== ЗАГРУЗКА ИЗ GIST ==============
    function syncFromGist(showNotify = false) {
        return new Promise((resolve, reject) => {
            const cfg = getConfig();
            
            if (!cfg.token || !cfg.gistId) {
                if (showNotify) notify('⚠️ Gist не настроен');
                resolve(false);
                return;
            }
            
            log('Loading from Gist...');
            
            fetch(`${GIST_API}/${cfg.gistId}`, {
                headers: {
                    'Authorization': `token ${cfg.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(data => {
                const content = data.files?.['timeline.json']?.content;
                if (!content) {
                    if (showNotify) notify('⚠️ Файл не найден');
                    resolve(false);
                    return;
                }
                
                const remote = JSON.parse(content);
                const remoteTimelines = remote.timelines || {};
                const remoteCount = Object.keys(remoteTimelines).length;
                
                log(`Gist has ${remoteCount} timelines`);
                
                if (remoteCount === 0) {
                    resolve(false);
                    return;
                }
                
                // ПРИМЕНЯЕМ ВСЕ ТАЙМЛАЙНЫ НАПРЯМУЮ
                let applied = 0;
                
                for (const hash in remoteTimelines) {
                    const item = remoteTimelines[hash];
                    
                    // Сохраняем во все ключи
                    saveToAllKeys(hash, item.time, item.duration, item.percent);
                    
                    // ВАЖНО: Используем Lampa.Timeline.update для обновления интерфейса
                    if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
                        try {
                            Lampa.Timeline.update({
                                hash: hash,
                                time: Math.round(item.time || 0),
                                duration: Math.round(item.duration || 0),
                                percent: Math.round(item.percent || 0),
                                force: true
                            });
                            applied++;
                        } catch(e) {
                            logError('Error applying timeline:', hash, e);
                        }
                    }
                }
                
                log(`Applied ${applied} timelines`);
                
                // Обновляем интерфейс
                if (applied > 0) {
                    refreshUI();
                    if (showNotify) notify(`📥 Загружено ${applied} таймлайнов`);
                } else {
                    if (showNotify) notify('✅ Данные актуальны');
                }
                
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                resolve(true);
            })
            .catch(err => {
                logError('Load error:', err);
                if (showNotify) notify('❌ Ошибка загрузки');
                reject(err);
            });
        });
    }

    // ============== ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ==============
    function refreshUI() {
        try {
            log('Refreshing UI...');
            
            // 1. Перечитываем таймлайны
            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                Lampa.Timeline.read(true);
                log('Timeline.read() called');
            }
            
            // 2. Обновляем Favorite
            if (Lampa.Favorite && typeof Lampa.Favorite.read === 'function') {
                Lampa.Favorite.read(true);
                log('Favorite.read() called');
            }
            
            // 3. Отправляем события
            if (Lampa.Listener) {
                Lampa.Listener.send('state:changed', {
                    target: 'timeline',
                    reason: 'refresh'
                });
                log('state:changed sent');
            }
            
            // 4. Принудительно обновляем DOM
            updateTimelineDOM();
            
            // 5. Перерисовываем активность
            const activity = Lampa.Activity.active();
            if (activity && activity.activity) {
                if (typeof activity.activity.render === 'function') {
                    activity.activity.render();
                }
                if (typeof activity.activity.update === 'function') {
                    activity.activity.update();
                }
                log('Activity updated');
            }
            
            log('UI refreshed');
        } catch(e) {
            logError('Refresh UI error:', e);
        }
    }

    // ============== ОБНОВЛЕНИЕ DOM ==============
    function updateTimelineDOM() {
        try {
            // Получаем все слои
            const layers = Lampa.Activity.renderLayers ? Lampa.Activity.renderLayers() : [];
            layers.push($(document));
            
            layers.forEach(layer => {
                // Обновляем прогресс-бары
                $('.time-line', layer).each(function() {
                    const hash = $(this).data('hash');
                    if (hash && Lampa.Timeline) {
                        const timeline = Lampa.Timeline.view(hash);
                        if (timeline && timeline.percent > 0) {
                            $(this).toggleClass('hide', false);
                            $('> div', this).css('width', timeline.percent + '%');
                        }
                    }
                });
                
                // Обновляем детали
                $('.time-line-details', layer).each(function() {
                    const hash = $(this).data('hash');
                    if (hash && Lampa.Timeline) {
                        const timeline = Lampa.Timeline.view(hash);
                        if (timeline && timeline.duration > 0 && Lampa.Timeline.format) {
                            const f = Lampa.Timeline.format(timeline);
                            $(this).find('[a="t"]').text(f.time);
                            $(this).find('[a="p"]').text(f.percent);
                            $(this).find('[a="d"]').text(f.duration);
                            $(this).toggleClass('hide', false);
                        }
                    }
                });
            });
            
            log('DOM updated');
        } catch(e) {
            logError('DOM update error:', e);
        }
    }

    // ============== ОБРАБОТЧИКИ СОБЫТИЙ ==============
    let saveTimer = null;

    function scheduleSync() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !syncInProgress) {
                syncToGist(false).catch(() => {});
            }
        }, 2000);
    }

    function forceSync() {
        clearTimeout(saveTimer);
        const cfg = getConfig();
        if (cfg.token && cfg.gistId && !syncInProgress) {
            syncToGist(false).catch(() => {});
        }
    }

    function initListeners() {
        // 1. Следим за изменениями таймлайна
        Lampa.Listener.follow('timeline', function(e) {
            if (e.type === 'update') {
                log('Timeline update:', e.data?.hash);
                scheduleSync();
            }
        });
        
        // 2. Следим за изменениями хранилища
        Lampa.Storage.listener.follow('change', function(e) {
            if (e.name === 'file_view' || e.name.startsWith('file_view_')) {
                log('Storage change:', e.name);
                scheduleSync();
            }
        });
        
        // 3. При открытии контента - загружаем
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'open') {
                log('Content opened');
                const cfg = getConfig();
                if (cfg.token && cfg.gistId) {
                    setTimeout(() => {
                        syncFromGist(false).catch(() => {});
                    }, 500);
                }
            }
        });
        
        // 4. При закрытии плеера - синхронизируем
        Lampa.Player.listener.follow('destroy', function() {
            log('Player destroyed');
            setTimeout(() => forceSync(), 1500);
        });
        
        log('Listeners initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !syncInProgress) {
                const timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    log('Periodic sync');
                    syncToGist(false).catch(() => {});
                }
            }
        }, SYNC_INTERVAL);
        
        // Также периодически загружаем
        setInterval(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !syncInProgress) {
                log('Periodic load');
                syncFromGist(false).catch(() => {});
            }
        }, SYNC_INTERVAL * 2);
        
        log('Periodic sync started');
    }

    // ============== МЕНЮ НАСТРОЕК ==============
    function showSetupMenu() {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        const currentKey = getTimelineKey();
        
        Lampa.Select.show({
            title: '☁️ Gist Sync V3',
            items: [
                { title: '🔑 Токен: ' + (cfg.token ? '✅' : '❌'), action: 'token' },
                { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌'), action: 'gist_id' },
                { title: '──────────', separator: true },
                { title: '📊 Таймлайнов: ' + count, action: 'info' },
                { title: '🔑 Ключ: ' + currentKey, action: 'info' },
                { title: '🕐 Синхр.: ' + lastSync, action: 'info' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить', action: 'upload' },
                { title: '📥 Загрузить', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🔄 Авто: ' + (cfg.autoSync ? '✅' : '❌'), action: 'toggle' },
                { title: '──────────', separator: true },
                { title: '🔄 Обновить UI', action: 'refresh' },
                { title: '❌ Закрыть', action: 'close' }
            ],
            onSelect: function(item) {
                const newCfg = getConfig();
                
                switch(item.action) {
                    case 'token':
                        Lampa.Input.edit({
                            title: 'GitHub Token',
                            value: cfg.token,
                            nosave: true
                        }, function(val) {
                            if (val !== null) {
                                newCfg.token = val.trim();
                                saveConfig(newCfg);
                                notify('Токен сохранён');
                            }
                            showSetupMenu();
                        });
                        break;
                        
                    case 'gist_id':
                        Lampa.Input.edit({
                            title: 'Gist ID',
                            value: cfg.gistId,
                            nosave: true
                        }, function(val) {
                            if (val !== null) {
                                newCfg.gistId = val.trim();
                                saveConfig(newCfg);
                                notify('Gist ID сохранён');
                            }
                            showSetupMenu();
                        });
                        break;
                        
                    case 'upload':
                        Lampa.Loading.start();
                        syncToGist(true).finally(() => {
                            Lampa.Loading.stop();
                            setTimeout(showSetupMenu, 500);
                        });
                        break;
                        
                    case 'download':
                        Lampa.Loading.start();
                        syncFromGist(true).finally(() => {
                            Lampa.Loading.stop();
                            setTimeout(showSetupMenu, 500);
                        });
                        break;
                        
                    case 'toggle':
                        newCfg.autoSync = !newCfg.autoSync;
                        saveConfig(newCfg);
                        notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                        showSetupMenu();
                        break;
                        
                    case 'refresh':
                        refreshUI();
                        notify('🔄 UI обновлён');
                        setTimeout(showSetupMenu, 500);
                        break;
                        
                    default:
                        showSetupMenu();
                        break;
                }
            },
            onBack: function() {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============== ДОБАВЛЕНИЕ В МЕНЮ ==============
    function addMenuButton() {
        try {
            if (Lampa.SettingsApi) {
                Lampa.SettingsApi.addComponent({
                    component: 'timeline_gist_v3',
                    name: 'Gist Sync V3',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
                });
                
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist_v3',
                    param: { name: 'timeline_gist_v3_setup', type: 'button' },
                    field: {
                        name: 'Настройка Gist',
                        description: 'Синхронизация таймлайнов V3'
                    },
                    onChange: showSetupMenu
                });
                
                log('Added to Settings API');
                return;
            }
        } catch(e) {
            logError('Settings API error:', e);
        }
        
        setTimeout(() => {
            const menuList = $('.menu__list').eq(0);
            if (!menuList.length) return;
            
            if ($('.timeline-gist-v3-menu').length) return;
            
            const menuItem = $(`
                <li class="menu__item selector timeline-gist-v3-menu">
                    <div class="menu__ico">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/>
                        </svg>
                    </div>
                    <div class="menu__text">Gist Sync V3</div>
                </li>
            `);
            
            menuItem.on('hover:enter', showSetupMenu);
            menuList.append(menuItem);
            
            log('Added to main menu');
        }, 2000);
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        log('========================================');
        log('V3 Starting...');
        log('Storage key:', getTimelineKey());
        log('Profile ID:', getProfileId() || 'none');
        
        const timelines = getAllTimelines();
        log('Local timelines:', Object.keys(timelines).length);
        log('========================================');
        
        initListeners();
        startPeriodicSync();
        
        // Загружаем при старте
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(() => {
                syncFromGist(false).catch(() => {});
            }, 3000);
        }
        
        addMenuButton();
        
        log('V3 Ready!');
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
