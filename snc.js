(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const GIST_API = 'https://api.github.com/gists';

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
    function getGistData() {
        const cfg = getConfig();
        if (!cfg.token || !cfg.gistId) return null;
        return { token: cfg.token, id: cfg.gistId };
    }

    function syncToGist(showNotify = true) {
        const gist = getGistData();
        if (!gist) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
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

        $.ajax({
            url: `${GIST_API}/${gist.id}`,
            method: 'PATCH',
            headers: {
                'Authorization': `token ${gist.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            data: JSON.stringify(data),
            success: function() {
                const cfg = getConfig();
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                if (showNotify) notify('✅ Синхронизировано ' + count + ' таймлайнов');
                console.log('[TimelineSync] Sync complete:', count, 'items');
            },
            error: function(xhr) {
                console.error('[TimelineSync] Sync error:', xhr);
                if (showNotify) notify('❌ Ошибка: ' + (xhr.responseJSON?.message || 'Unknown'));
            }
        });
    }

    function syncFromGist(showNotify = true) {
        const gist = getGistData();
        if (!gist) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        $.ajax({
            url: `${GIST_API}/${gist.id}`,
            method: 'GET',
            headers: {
                'Authorization': `token ${gist.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            success: function(data) {
                try {
                    const content = data.files?.['timeline.json']?.content;
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

                    // Сохраняем в file_view
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
                        
                        // Обновляем Lampa.Timeline
                        if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function') {
                            Lampa.Timeline.read(true);
                        }
                        
                        if (showNotify) notify(`📥 Загружено ${changes} таймлайнов`);
                    } else {
                        if (showNotify) notify('✅ Данные актуальны');
                    }

                    const cfg = getConfig();
                    cfg.lastSync = Date.now();
                    saveConfig(cfg);

                } catch(e) {
                    console.error('[TimelineSync] Parse error:', e);
                    if (showNotify) notify('❌ Ошибка чтения данных');
                }
            },
            error: function(xhr) {
                console.error('[TimelineSync] Load error:', xhr);
                if (showNotify) notify('❌ Ошибка загрузки: ' + (xhr.responseJSON?.message || 'Unknown'));
            }
        });
    }

    // ============== СОБЫТИЯ ПЛЕЕРА ==============
    let syncTimer = null;
    let lastSyncTime = 0;

    function scheduleSync() {
        const now = Date.now();
        // Не синхронизируем чаще чем раз в 10 секунд
        if (now - lastSyncTime < 10000) return;
        
        lastSyncTime = now;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                syncToGist(false);
            }
        }, 5000);
    }

    function initPlayerListeners() {
        // При обновлении времени - планируем синхронизацию
        Lampa.Player.listener.follow('timeupdate', function(e) {
            scheduleSync();
        });

        // При закрытии плеера - синхронизируем сразу
        Lampa.Player.listener.follow('destroy', function() {
            clearTimeout(syncTimer);
            setTimeout(() => {
                const cfg = getConfig();
                if (cfg.token && cfg.gistId) {
                    syncToGist(false);
                }
            }, 1000);
        });

        console.log('[TimelineSync] Player listeners initialized');
    }

    // ============== НАСТРОЙКИ ==============
    function setupSettings() {
        if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
            Lampa.SettingsApi.addComponent({
                component: 'timeline_gist',
                name: 'Синхронизация таймлайнов',
                icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
            });
        }

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_token',
                type: 'input'
            },
            field: {
                name: 'GitHub Token',
                description: 'Personal Access Token для доступа к Gist'
            },
            onChange: function(value) {
                const cfg = getConfig();
                cfg.token = value || '';
                saveConfig(cfg);
                notify('Токен сохранен');
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_id',
                type: 'input'
            },
            field: {
                name: 'Gist ID',
                description: 'ID существующего Gist (оставьте пустым для создания)'
            },
            onChange: function(value) {
                const cfg = getConfig();
                cfg.gistId = value || '';
                saveConfig(cfg);
                notify('Gist ID сохранен');
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_sync_now',
                type: 'button'
            },
            field: {
                name: 'Выгрузить в Gist',
                description: 'Синхронизировать таймлайны с Gist'
            },
            onChange: function() {
                syncToGist(true);
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'timeline_gist_load_now',
                type: 'button'
            },
            field: {
                name: 'Загрузить из Gist',
                description: 'Загрузить таймлайны из Gist'
            },
            onChange: function() {
                syncFromGist(true);
            }
        });

        console.log('[TimelineSync] Settings initialized');
    }

    // ============== ПЕРИОДИЧЕСКАЯ СИНХРОНИЗАЦИЯ ==============
    function startPeriodicSync() {
        setInterval(() => {
            const cfg = getConfig();
            if (cfg.token && cfg.gistId) {
                const timelines = getAllTimelines();
                if (Object.keys(timelines).length > 0) {
                    syncToGist(false);
                }
            }
        }, 60000); // Каждую минуту
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        const cfg = getConfig();
        if (!cfg.enabled) {
            console.log('[TimelineSync] Disabled');
            return;
        }

        const key = getFileViewKey();
        const timelines = getAllTimelines();
        const count = Object.keys(timelines).length;
        
        console.log('[TimelineSync] Initialized');
        console.log('[TimelineSync] Profile:', getProfileId() || 'default');
        console.log('[TimelineSync] File view key:', key);
        console.log('[TimelineSync] Found', count, 'timelines');
        console.log('[TimelineSync] Token:', cfg.token ? '✓' : '✗');
        console.log('[TimelineSync] Gist ID:', cfg.gistId ? '✓' : '✗');

        // Настройки
        setupSettings();

        // Слушатели плеера
        initPlayerListeners();

        // Периодическая синхронизация
        startPeriodicSync();

        // Загружаем из Gist при старте
        if (cfg.token && cfg.gistId) {
            setTimeout(() => {
                syncFromGist(false);
            }, 5000);
        }

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
