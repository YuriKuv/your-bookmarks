(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;

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

    // ============== ХРАНИЛИЩЕ ==============
    function getConfig() {
        return Lampa.Storage.get(CFG_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            enabled: true
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(CFG_KEY, cfg, true);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ============== ПОЛУЧЕНИЕ ТАЙМЛАЙНОВ ==============
    function getAllTimelines() {
        const key = getFileViewKey();
        const data = Lampa.Storage.get(key, {});
        const timelines = {};
        const now = Date.now();

        for (const hash in data) {
            const item = data[hash];
            if (!item || !item.time || item.time <= 0) continue;
            
            timelines[hash] = {
                time: Math.round(item.time),
                duration: Math.round(item.duration || 0),
                percent: Math.round(item.percent || 0),
                updatedAt: item.updated || now
            };
        }

        return timelines;
    }

    // ============== РАБОТА С GIST ==============
    function syncToGist(showNotify = true) {
        const cfg = getConfig();
        
        if (!cfg.token) {
            if (showNotify) notify('⚠️ GitHub Token не настроен');
            return false;
        }

        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        if (count === 0) {
            if (showNotify) notify('⚠️ Нет таймлайнов для синхронизации');
            console.log('[TimelineSync] No timelines found');
            return false;
        }

        console.log('[TimelineSync] Syncing', count, 'timelines to Gist');

        const data = {
            description: 'Lampa Timeline Sync - ' + (getProfileId() || 'default'),
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

        let url = GIST_API;
        let method = 'POST';
        
        if (cfg.gistId) {
            url = GIST_API + '/' + cfg.gistId;
            method = 'PATCH';
        }

        $.ajax({
            url: url,
            method: method,
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json'
            },
            data: JSON.stringify(data),
            success: function(response) {
                if (!cfg.gistId && response && response.id) {
                    const newCfg = getConfig();
                    newCfg.gistId = response.id;
                    newCfg.lastSync = Date.now();
                    saveConfig(newCfg);
                    if (showNotify) notify('✅ Создан новый Gist: ' + response.id);
                } else {
                    const newCfg = getConfig();
                    newCfg.lastSync = Date.now();
                    saveConfig(newCfg);
                    if (showNotify) notify('✅ Синхронизировано ' + count + ' таймлайнов');
                }
                console.log('[TimelineSync] Sync complete:', count, 'items');
            },
            error: function(xhr) {
                console.error('[TimelineSync] Sync error:', xhr);
                if (xhr.status === 404 && cfg.gistId) {
                    const newCfg = getConfig();
                    newCfg.gistId = '';
                    saveConfig(newCfg);
                    if (showNotify) notify('🔄 Gist не найден, создаю новый...');
                    setTimeout(function() {
                        syncToGist(showNotify);
                    }, 1000);
                } else {
                    let errorMsg = 'Ошибка синхронизации';
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response && response.message) {
                            errorMsg = response.message;
                        }
                    } catch(e) {}
                    if (showNotify) notify('❌ ' + errorMsg);
                }
            }
        });
    }

    function syncFromGist(showNotify = true) {
        const cfg = getConfig();
        
        if (!cfg.token) {
            if (showNotify) notify('⚠️ GitHub Token не настроен');
            return false;
        }

        if (!cfg.gistId) {
            if (showNotify) notify('⚠️ Gist ID не настроен');
            return false;
        }

        $.ajax({
            url: GIST_API + '/' + cfg.gistId,
            method: 'GET',
            headers: {
                'Authorization': 'token ' + cfg.token,
                'Accept': 'application/vnd.github.v3+json'
            },
            success: function(data) {
                try {
                    const content = data.files && data.files['timeline.json'] ? data.files['timeline.json'].content : null;
                    if (!content) {
                        if (showNotify) notify('⚠️ Файл timeline.json не найден');
                        return;
                    }

                    const remote = JSON.parse(content);
                    const remoteTimelines = remote.timelines || {};
                    
                    if (Object.keys(remoteTimelines).length === 0) {
                        if (showNotify) notify('⚠️ В Gist нет таймлайнов');
                        return;
                    }

                    const key = getFileViewKey();
                    const fileView = Lampa.Storage.get(key, {});
                    let changes = 0;

                    for (const hash in remoteTimelines) {
                        const remoteData = remoteTimelines[hash];
                        const localData = fileView[hash];
                        
                        if (!localData || remoteData.updatedAt > (localData.updated || 0)) {
                            fileView[hash] = {
                                time: remoteData.time,
                                duration: remoteData.duration || 0,
                                percent: remoteData.percent || 0,
                                updated: remoteData.updatedAt || Date.now()
                            };
                            changes++;
                        }
                    }

                    if (changes > 0) {
                        Lampa.Storage.set(key, fileView, true);
                        
                        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                            Lampa.Timeline.read(true);
                        }
                        
                        if (showNotify) notify('📥 Загружено ' + changes + ' таймлайнов');
                    } else {
                        if (showNotify) notify('✅ Данные актуальны');
                    }

                    const newCfg = getConfig();
                    newCfg.lastSync = Date.now();
                    saveConfig(newCfg);

                } catch(e) {
                    console.error('[TimelineSync] Parse error:', e);
                    if (showNotify) notify('❌ Ошибка чтения данных');
                }
            },
            error: function(xhr) {
                console.error('[TimelineSync] Load error:', xhr);
                if (xhr.status === 404) {
                    if (showNotify) notify('❌ Gist не найден (404)');
                } else {
                    let errorMsg = 'Ошибка загрузки';
                    try {
                        const response = JSON.parse(xhr.responseText);
                        if (response && response.message) {
                            errorMsg = response.message;
                        }
                    } catch(e) {}
                    if (showNotify) notify('❌ ' + errorMsg);
                }
            }
        });
    }

    // ============== ДИАЛОГ НАСТРОЕК ==============
    function showGistSetup() {
        const cfg = getConfig();
        const count = Object.keys(getAllTimelines()).length;
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        
        Lampa.Select.show({
            title: '☁️ GitHub Gist Синхронизация',
            items: [
                { 
                    title: '🔑 Токен: ' + (cfg.token ? '✓ Установлен' : '❌ Не установлен'), 
                    action: 'token' 
                },
                { 
                    title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), 
                    action: 'id' 
                },
                { title: '──────────', separator: true },
                { 
                    title: '📊 Таймлайнов: ' + count, 
                    action: 'status' 
                },
                { 
                    title: '🔄 Последняя синхр.: ' + lastSync, 
                    action: 'status' 
                },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: '🗑️ Очистить локальные', action: 'clear' },
                { title: '──────────', separator: true },
                { title: '❌ Закрыть', action: 'cancel' }
            ],
            onSelect: function(item) {
                if (item.action === 'token') {
                    Lampa.Input.edit({
                        title: 'GitHub Personal Access Token',
                        value: cfg.token,
                        free: true
                    }, function(val) {
                        if (val !== null) {
                            const newCfg = getConfig();
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
                        free: true
                    }, function(val) {
                        if (val !== null) {
                            const newCfg = getConfig();
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
                    syncFromGist(true);
                    setTimeout(function() {
                        showGistSetup();
                    }, 2000);
                } else if (item.action === 'clear') {
                    Lampa.Select.show({
                        title: '⚠️ Удалить все таймлайны?',
                        items: [
                            { title: 'Нет', action: 'cancel' },
                            { title: 'Да, удалить', action: 'clear' }
                        ],
                        onSelect: function(opt) {
                            if (opt.action === 'clear') {
                                const key = getFileViewKey();
                                Lampa.Storage.set(key, {}, true);
                                Lampa.Storage.set('file_view', {}, true);
                                if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                                    Lampa.Timeline.read(true);
                                }
                                notify('🗑️ Таймлайны очищены');
                                showGistSetup();
                            }
                        },
                        onBack: function() {
                            showGistSetup();
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

    // ============== НАСТРОЙКИ ЧЕРЕЗ SettingsApi (как в ybt.js) ==============
    function setupSettings() {
        // Добавляем компонент в настройки
        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
            Lampa.SettingsApi.addComponent({
                component: 'timeline_gist',
                name: 'Синхронизация таймлайнов',
                icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
            });
        }

        // Параметр: GitHub Gist синхронизация (кнопка)
        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_setup',
                    type: 'button'
                },
                field: {
                    name: 'GitHub Gist синхронизация',
                    description: 'Настройка облачной синхронизации прогресса просмотра'
                },
                onChange: function() {
                    showGistSetup();
                }
            });
        }

        // Параметр: принудительная синхронизация
        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_force_sync',
                    type: 'button'
                },
                field: {
                    name: 'Принудительная синхронизация',
                    description: 'Выгрузить текущие таймлайны в Gist'
                },
                onChange: function() {
                    syncToGist(true);
                }
            });
        }

        // Параметр: очистка
        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
            Lampa.SettingsApi.addParam({
                component: 'timeline_gist',
                param: {
                    name: 'timeline_gist_clear',
                    type: 'button'
                },
                field: {
                    name: 'Очистить локальные таймлайны',
                    description: 'Удалить все сохраненные прогрессы просмотра'
                },
                onChange: function() {
                    Lampa.Select.show({
                        title: 'Удалить все таймлайны?',
                        items: [
                            { title: 'Нет', action: 'cancel' },
                            { title: 'Да, удалить', action: 'clear' }
                        ],
                        onSelect: function(opt) {
                            if (opt.action === 'clear') {
                                const key = getFileViewKey();
                                Lampa.Storage.set(key, {}, true);
                                Lampa.Storage.set('file_view', {}, true);
                                if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                                    Lampa.Timeline.read(true);
                                }
                                notify('🗑️ Таймлайны очищены');
                            }
                        }
                    });
                }
            });
        }

        console.log('[TimelineSync] Settings initialized via SettingsApi');
    }

    // ============== СОБЫТИЯ ПЛЕЕРА ==============
    var syncTimer = null;
    var lastSyncTime = 0;

    function scheduleSync() {
        var now = Date.now();
        if (now - lastSyncTime < 10000) return;
        
        lastSyncTime = now;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(function() {
            var cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                syncToGist(false);
            }
        }, 5000);
    }

    function initPlayerListeners() {
        Lampa.Player.listener.follow('timeupdate', function(e) {
            scheduleSync();
        });

        Lampa.Player.listener.follow('destroy', function() {
            clearTimeout(syncTimer);
            setTimeout(function() {
                var cfg = getConfig();
                if (cfg.token && cfg.gistId) {
                    syncToGist(false);
                }
            }, 1000);
        });

        console.log('[TimelineSync] Player listeners initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(function() {
            var cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                var timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    syncToGist(false);
                }
            }
        }, SYNC_INTERVAL);
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadOnStart() {
        var cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(function() {
                syncFromGist(false);
            }, 5000);
        }
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        var cfg = getConfig();
        if (!cfg.enabled) {
            console.log('[TimelineSync] Disabled');
            return;
        }

        var key = getFileViewKey();
        var timelines = getAllTimelines();
        var count = Object.keys(timelines).length;
        
        console.log('[TimelineSync] ===== INIT =====');
        console.log('[TimelineSync] Profile:', getProfileId() || 'default');
        console.log('[TimelineSync] File view key:', key);
        console.log('[TimelineSync] Found', count, 'timelines');
        console.log('[TimelineSync] Token:', cfg.token ? '✓' : '✗');
        console.log('[TimelineSync] Gist ID:', cfg.gistId ? '✓' : '✗');
        console.log('[TimelineSync] =================');

        // Настройки через SettingsApi (как в ybt.js)
        setupSettings();

        initPlayerListeners();
        startPeriodicSync();
        loadOnStart();

        console.log('[TimelineSync] Ready');
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
