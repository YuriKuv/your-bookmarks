(function() {
    'use strict';

    if (window.timeline_gist_loaded) return;
    window.timeline_gist_loaded = true;

    // ============== КОНФИГУРАЦИЯ ==============
    const CFG_KEY = 'timeline_gist_config';
    const STORE_KEY = 'timeline_gist_cache';
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

    // ============== НАСТРОЙКИ (без SettingsApi) ==============
    function showSettingsDialog() {
        const cfg = getConfig();
        
        Lampa.Select.show({
            title: '☁️ Синхронизация таймлайнов',
            items: [
                { 
                    title: `🔑 Токен: ${cfg.token ? '✓ Установлен' : '❌ Не установлен'}`, 
                    action: 'token' 
                },
                { 
                    title: `📄 Gist ID: ${cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не установлен'}`, 
                    action: 'id' 
                },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '──────────', separator: true },
                { title: `🔄 Статус: ${cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда'}`, action: 'status' },
                { title: '──────────', separator: true },
                { title: '❌ Закрыть', action: 'cancel' }
            ],
            onSelect: (item) => {
                if (item.action === 'token') {
                    Lampa.Input.edit({
                        title: 'GitHub Personal Access Token',
                        value: cfg.token,
                        free: true
                    }, (val) => {
                        if (val !== null) {
                            cfg.token = val || '';
                            saveConfig(cfg);
                            notify('Токен сохранён');
                        }
                        showSettingsDialog();
                    });
                } else if (item.action === 'id') {
                    Lampa.Input.edit({
                        title: 'Gist ID',
                        value: cfg.gistId,
                        free: true
                    }, (val) => {
                        if (val !== null) {
                            cfg.gistId = val || '';
                            saveConfig(cfg);
                            notify('Gist ID сохранён');
                        }
                        showSettingsDialog();
                    });
                } else if (item.action === 'upload') {
                    syncToGist(true);
                    setTimeout(() => showSettingsDialog(), 1500);
                } else if (item.action === 'download') {
                    syncFromGist(true);
                    setTimeout(() => showSettingsDialog(), 1500);
                } else if (item.action === 'status') {
                    showSettingsDialog();
                }
            },
            onBack: () => {
                Lampa.Controller.toggle('content');
            }
        });
    }

    // ============== ДОБАВЛЕНИЕ ПУНКТА В МЕНЮ ==============
    function addSettingsMenuItem() {
        setTimeout(function() {
            var ml = $('.menu__list').eq(0);
            if (!ml.length) return;
            
            // Проверяем, не добавлен ли уже
            if ($('.timeline-gist-settings-item').length) return;
            
            var el = $(
                '<li class="menu__item selector timeline-gist-settings-item">' +
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
                showSettingsDialog();
            });
            
            ml.append(el);
            console.log('[TimelineSync] Menu item added');
        }, 2000);
    }

    // ============== СОБЫТИЯ ПЛЕЕРА ==============
    let syncTimer = null;
    let lastSyncTime = 0;

    function scheduleSync() {
        const now = Date.now();
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
        Lampa.Player.listener.follow('timeupdate', function(e) {
            scheduleSync();
        });

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
        }, 60000);
    }

    // ============== ЗАГРУЗКА ПРИ СТАРТЕ ==============
    function loadOnStart() {
        const cfg = getConfig();
        if (cfg.token && cfg.gistId) {
            setTimeout(() => {
                syncFromGist(false);
            }, 5000);
        }
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
        
        console.log('[TimelineSync] ===== INIT =====');
        console.log('[TimelineSync] Profile:', getProfileId() || 'default');
        console.log('[TimelineSync] File view key:', key);
        console.log('[TimelineSync] Found', count, 'timelines');
        console.log('[TimelineSync] Token:', cfg.token ? '✓' : '✗');
        console.log('[TimelineSync] Gist ID:', cfg.gistId ? '✓' : '✗');
        console.log('[TimelineSync] =================');

        // Добавляем пункт в меню
        addSettingsMenuItem();

        // Слушатели плеера
        initPlayerListeners();

        // Периодическая синхронизация
        startPeriodicSync();

        // Загружаем из Gist при старте
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
