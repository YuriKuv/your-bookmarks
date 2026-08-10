(function() {
    'use strict';

    if (window.timeline_gist_sync_loaded) return;
    window.timeline_gist_sync_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const PLUGIN_NAME = 'TimelineSync';
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;
    const SAVE_DELAY = 2000;
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
            autoSync: true,
            version: 0
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
        if (Lampa.Account && Lampa.Account.Permit && Lampa.Account.Permit.sync) {
            return 'file_view_' + Lampa.Account.Permit.account.profile.id;
        }
        return 'file_view';
    }

    // ============== ХЕШ-ФУНКЦИЯ (ТОЧНАЯ КОПИЯ ИЗ LAMPA) ==============
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

    // ============== РАБОТА С ТАЙМЛАЙНАМИ ==============
    function getAllTimelines() {
        const result = {};
        const key = getTimelineKey();
        
        try {
            const data = Lampa.Storage.get(key, {});
            
            if (typeof data === 'object' && data !== null) {
                for (const hash in data) {
                    const item = data[hash];
                    if (!item || typeof item === 'number') continue;
                    
                    result[hash] = {
                        time: Math.round(item.time || 0),
                        duration: Math.round(item.duration || 0),
                        percent: Math.round(item.percent || 0),
                        updated: item.updated || Date.now()
                    };
                }
            }
        } catch(e) {
            logError('Error reading:', e);
        }
        
        return result;
    }

    function saveAllTimelines(timelines) {
        const key = getTimelineKey();
        const data = {};
        
        for (const hash in timelines) {
            const item = timelines[hash];
            data[hash] = {
                time: item.time,
                duration: item.duration || 0,
                percent: item.percent || 0,
                updated: item.updated || Date.now()
            };
        }
        
        Lampa.Storage.set(key, data);
        log('Saved', Object.keys(data).length, 'timelines to', key);
        
        // Обновляем внутренний кеш Lampa.Timeline
        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
            Lampa.Timeline.read(true);
        }
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
                            version: (cfg.version || 0) + 1,
                            profile: getProfileId() || 'default',
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
                if (response.status === 409) {
                    return resolveConflict(timelines);
                }
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(() => {
                cfg.lastSync = Date.now();
                cfg.version = (cfg.version || 0) + 1;
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
                            version: 1,
                            profile: getProfileId() || 'default',
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
            cfg.version = 1;
            saveConfig(cfg);
            notify(`✅ Gist создан: ${data.id}`);
            log('Gist created:', data.id);
        });
    }

    function resolveConflict(localTimelines) {
        const cfg = getConfig();
        
        return fetch(`${GIST_API}/${cfg.gistId}`, {
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
            if (!content) return;
            
            const remote = JSON.parse(content);
            const remoteTimelines = remote.timelines || {};
            
            const merged = { ...remoteTimelines };
            for (const hash in localTimelines) {
                if (!merged[hash] || 
                    (localTimelines[hash].updated || 0) > (merged[hash].updated || 0)) {
                    merged[hash] = localTimelines[hash];
                }
            }
            
            const mergedCount = Object.keys(merged).length;
            const newVersion = (remote.version || cfg.version || 0) + 1;
            
            return fetch(`${GIST_API}/${cfg.gistId}`, {
                method: 'PATCH',
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
                                version: newVersion,
                                profile: getProfileId() || 'default',
                                updated: new Date().toISOString(),
                                count: mergedCount,
                                timelines: merged
                            }, null, 2)
                        }
                    }
                })
            });
        });
    }

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
                
                log(`Gist has ${remoteCount} timelines, version ${remote.version}`);
                
                if (remoteCount === 0) {
                    if (showNotify) notify('⚠️ Gist пуст');
                    resolve(false);
                    return;
                }
                
                if (remote.version <= cfg.version && cfg.version > 0) {
                    log('Local version is up to date');
                    if (showNotify) notify('✅ Данные актуальны');
                    resolve(true);
                    return;
                }
                
                const localTimelines = getAllTimelines();
                const merged = { ...localTimelines };
                let changes = 0;
                
                for (const hash in remoteTimelines) {
                    const remoteData = remoteTimelines[hash];
                    const localData = merged[hash];
                    
                    if (!localData || 
                        (remoteData.updated || 0) > (localData.updated || 0)) {
                        merged[hash] = remoteData;
                        changes++;
                    }
                }
                
                if (changes > 0) {
                    saveAllTimelines(merged);
                    applyToCurrentMovie(merged);
                    refreshUI();
                    
                    cfg.version = remote.version || 1;
                    cfg.lastSync = Date.now();
                    saveConfig(cfg);
                    
                    if (showNotify) notify(`📥 Загружено ${changes} таймлайнов`);
                } else {
                    cfg.version = remote.version || 1;
                    cfg.lastSync = Date.now();
                    saveConfig(cfg);
                    
                    if (showNotify) notify('✅ Данные актуальны');
                }
                
                resolve(true);
            })
            .catch(err => {
                logError('Load error:', err);
                if (showNotify) notify('❌ Ошибка загрузки');
                reject(err);
            });
        });
    }

    // ============== ПРИМЕНЕНИЕ К ТЕКУЩЕМУ ФИЛЬМУ ==============
    function applyToCurrentMovie(timelines) {
        try {
            const activity = Lampa.Activity.active();
            const movie = activity?.movie;
            if (!movie) return;
            
            const hash = generateHash(movie, activity?.season, activity?.episode);
            if (!hash || !timelines[hash]) return;
            
            const data = timelines[hash];
            
            if (Lampa.Timeline && typeof Lampa.Timeline.update === 'function') {
                Lampa.Timeline.update({
                    hash: hash,
                    time: data.time,
                    duration: data.duration || 0,
                    percent: data.percent || 0,
                    force: true
                });
                log('Applied to current movie:', hash, data.percent + '%');
            }
        } catch(e) {
            logError('Apply error:', e);
        }
    }

    // ============== ОБНОВЛЕНИЕ ИНТЕРФЕЙСА ==============
    function refreshUI() {
        try {
            if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                Lampa.Timeline.read(true);
            }
            
            if (Lampa.Favorite && typeof Lampa.Favorite.read === 'function') {
                Lampa.Favorite.read(true);
            }
            
            if (Lampa.Listener) {
                Lampa.Listener.send('state:changed', {
                    target: 'timeline',
                    reason: 'refresh'
                });
            }
            
            const activity = Lampa.Activity.active();
            if (activity && activity.activity && typeof activity.activity.refresh === 'function') {
                activity.activity.refresh();
            }
            
            log('UI refreshed');
        } catch(e) {
            logError('Refresh UI error:', e);
        }
    }

    // ============== ОБРАБОТЧИКИ СОБЫТИЙ ==============
    let saveTimer = null;
    let pendingSync = false;

    function scheduleSync() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !syncInProgress) {
                syncToGist(false).catch(() => {});
            }
            pendingSync = false;
        }, SAVE_DELAY);
        pendingSync = true;
    }

    function forceSync() {
        clearTimeout(saveTimer);
        pendingSync = false;
        const cfg = getConfig();
        if (cfg.token && cfg.gistId && !syncInProgress) {
            syncToGist(false).catch(() => {});
        }
    }

    function initListeners() {
        // 1. Следим за изменениями таймлайна через Lampa.Listener
        Lampa.Listener.follow('timeline', function(e) {
            if (e.type === 'update') {
                log('Timeline update event:', e.data?.hash);
                scheduleSync();
            }
        });
        
        // 2. Следим за изменениями в хранилище (важно для Android!)
        Lampa.Storage.listener.follow('change', function(e) {
            const key = getTimelineKey();
            if (e.name === key || e.name === 'file_view') {
                log('Storage change:', e.name);
                scheduleSync();
            }
        });
        
        // 3. При открытии контента - загружаем из Gist
        Lampa.Listener.follow('full', function(e) {
            if (e.type === 'open') {
                log('Content opened, loading from Gist...');
                const cfg = getConfig();
                if (cfg.token && cfg.gistId) {
                    setTimeout(() => {
                        syncFromGist(false).catch(() => {});
                    }, 500);
                }
            }
        });
        
        // 4. ВАЖНО: Перехватываем Android timeCall
        // Когда Android приложение закрывает внешний плеер, оно вызывает Android.timeCall()
        if (typeof Android !== 'undefined' && Android.timeCall) {
            const originalTimeCall = Android.timeCall;
            Android.timeCall = function(timeline) {
                log('Android timeCall intercepted:', timeline.hash, timeline.percent + '%');
                originalTimeCall.call(Android, timeline);
                // Принудительно синхронизируем после получения таймлайна от Android
                setTimeout(() => forceSync(), 1000);
            };
            log('Android timeCall hooked');
        }
        
        // 5. При уничтожении плеера - сохраняем
        Lampa.Player.listener.follow('destroy', function() {
            log('Player destroyed, syncing...');
            // Даем время на сохранение таймлайна
            setTimeout(() => {
                if (pendingSync) {
                    forceSync();
                } else {
                    scheduleSync();
                }
            }, 1500);
        });
        
        // 6. Следим за состоянием приложения (Android)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Приложение уходит в фон - синхронизируем
                log('App hidden, syncing...');
                if (pendingSync) {
                    forceSync();
                }
            } else {
                // Приложение возвращается - загружаем из Gist
                log('App visible, loading from Gist...');
                const cfg = getConfig();
                if (cfg.token && cfg.gistId) {
                    setTimeout(() => {
                        syncFromGist(false).catch(() => {});
                    }, 500);
                }
            }
        });
        
        log('Listeners initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        // Каждые 60 секунд проверяем, нужно ли синхронизировать
        setInterval(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId && cfg.autoSync && !syncInProgress) {
                const timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    // Проверяем, были ли изменения с последней синхронизации
                    const lastSync = cfg.lastSync || 0;
                    let hasChanges = false;
                    
                    for (const hash in timelines) {
                        if ((timelines[hash].updated || 0) > lastSync) {
                            hasChanges = true;
                            break;
                        }
                    }
                    
                    if (hasChanges) {
                        log('Periodic sync - changes detected');
                        syncToGist(false).catch(() => {});
                    }
                }
            }
        }, SYNC_INTERVAL);
        
        log('Periodic sync started');
    }

    // ============== МЕНЮ НАСТРОЕК ==============
    function showSetupMenu() {
        const cfg = getConfig();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist Sync',
            items: [
                { 
                    title: '🔑 Токен: ' + (cfg.token ? '✅ Установлен' : '❌ Не установлен'), 
                    action: 'token' 
                },
                { 
                    title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), 
                    action: 'gist_id' 
                },
                { 
                    title: '👤 Profile: ' + (getProfileId() || 'default'), 
                    action: 'info' 
                },
                { 
                    title: '📦 Key: ' + getTimelineKey(), 
                    action: 'info' 
                },
                { title: '──────────', separator: true },
                { title: '📊 Таймлайнов: ' + count, action: 'info' },
                { title: '🔄 Версия: ' + (cfg.version || 0), action: 'info' },
                { title: '🕐 Синхр.: ' + lastSync, action: 'info' },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { 
                    title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), 
                    action: 'toggle_auto' 
                },
                { title: '──────────', separator: true },
                { title: '🔄 Обновить интерфейс', action: 'refresh' },
                { title: '──────────', separator: true },
                { title: '❌ Закрыть', action: 'close' }
            ],
            onSelect: function(item) {
                const newCfg = getConfig();
                
                switch(item.action) {
                    case 'token':
                        Lampa.Input.edit({
                            title: 'GitHub Token (права: gist)',
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
                        
                    case 'toggle_auto':
                        newCfg.autoSync = !newCfg.autoSync;
                        saveConfig(newCfg);
                        notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                        showSetupMenu();
                        break;
                        
                    case 'refresh':
                        refreshUI();
                        notify('🔄 Интерфейс обновлён');
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
                    component: 'timeline_gist',
                    name: 'Синхронизация таймлайнов',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
                });
                
                Lampa.SettingsApi.addParam({
                    component: 'timeline_gist',
                    param: { name: 'timeline_gist_setup', type: 'button' },
                    field: {
                        name: 'Настройка Gist',
                        description: 'Синхронизация прогресса просмотра через GitHub Gist'
                    },
                    onChange: showSetupMenu
                });
                
                log('Added to Settings API');
                return;
            }
        } catch(e) {
            logError('Settings API error:', e);
        }
        
        // Fallback
        setTimeout(() => {
            const menuList = $('.menu__list').eq(0);
            if (!menuList.length) return;
            
            if ($('.timeline-gist-menu-item').length) return;
            
            const menuItem = $(`
                <li class="menu__item selector timeline-gist-menu-item">
                    <div class="menu__ico">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/>
                        </svg>
                    </div>
                    <div class="menu__text">Синхр. таймлайнов</div>
                </li>
            `);
            
            menuItem.on('hover:enter', showSetupMenu);
            menuList.append(menuItem);
            
            log('Added to main menu (fallback)');
        }, 2000);
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        log('========================================');
        log('Plugin starting...');
        log('Storage key:', getTimelineKey());
        log('Profile ID:', getProfileId() || 'none');
        
        const timelines = getAllTimelines();
        log('Local timelines:', Object.keys(timelines).length);
        log('========================================');
        
        initListeners();
        startPeriodicSync();
        
        // Загружаем данные при старте
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(() => {
                syncFromGist(false)
                    .then(() => refreshUI())
                    .catch(() => {});
            }, 3000);
        }
        
        addMenuButton();
        
        log('Plugin ready!');
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
