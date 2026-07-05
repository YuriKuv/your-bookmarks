(function () {
    'use strict';

    if (window.timeline_gist_init) return;
    window.timeline_gist_init = true;

    // ========= CONSTANTS =========
    const STORE_KEY = 'tl_gist_data';
    const CFG_KEY = 'tl_gist_cfg';
    const GIST_API_URL = 'https://api.github.com/gists';
    const SYNC_DEBOUNCE_MS = 5000;

    // ========= CONFIG =========
    function cfg() {
        return Lampa.Storage.get(CFG_KEY, {
            enabled: true,
            gist_token: '',
            gist_id: '',
            sync_on_start: true,
            sync_on_close: true,
            sync_auto_interval: true,
            sync_interval_minutes: 60,
            sync_on_timeupdate: true,
            last_sync: 0
        }) || {};
    }

    function saveCfg(c) {
        Lampa.Storage.set(CFG_KEY, c, true);
    }

    // ========= STORAGE =========
    function getTimelines() {
        return Lampa.Storage.get(STORE_KEY, {}) || {};
    }

    function saveTimelines(data) {
        Lampa.Storage.set(STORE_KEY, data, true);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    // ========= GIST SYNC =========
    function getGistData() {
        const c = cfg();
        if (!c.gist_token || !c.gist_id) return null;
        return { token: c.gist_token, id: c.gist_id };
    }

    function syncToGist(showNotify = true) {
        const gist = getGistData();
        if (!gist) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        const timelines = getTimelines();
        const data = {
            description: 'Lampa Timeline Sync',
            public: false,
            files: {
                'timeline.json': {
                    content: JSON.stringify({
                        version: 2,
                        updated: new Date().toISOString(),
                        timelines: timelines
                    }, null, 2)
                }
            }
        };

        $.ajax({
            url: `${GIST_API_URL}/${gist.id}`,
            method: 'PATCH',
            headers: {
                'Authorization': `token ${gist.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            data: JSON.stringify(data),
            success: function() {
                const c = cfg();
                c.last_sync = Date.now();
                saveCfg(c);
                if (showNotify) notify('✅ Таймлайны синхронизированы');
            },
            error: function(xhr) {
                console.error('[TimelineSync] Error:', xhr);
                if (showNotify) notify('❌ Ошибка синхронизации: ' + (xhr.responseJSON?.message || 'Unknown error'));
            }
        });
    }

    function syncFromGist(showNotify = true, merge = true) {
        const gist = getGistData();
        if (!gist) {
            if (showNotify) notify('⚠️ GitHub Gist не настроен');
            return false;
        }

        $.ajax({
            url: `${GIST_API_URL}/${gist.id}`,
            method: 'GET',
            headers: {
                'Authorization': `token ${gist.token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            success: function(data) {
                try {
                    const content = data.files['timeline.json']?.content;
                    if (!content) {
                        if (showNotify) notify('⚠️ Файл timeline.json не найден');
                        return;
                    }

                    const remote = JSON.parse(content);
                    const remoteTimelines = remote.timelines || {};
                    const localTimelines = getTimelines();

                    let merged = {};
                    
                    if (merge) {
                        // Объединяем: remote + local (remote приоритетнее)
                        merged = { ...localTimelines };
                        for (const key in remoteTimelines) {
                            if (!merged[key] || remoteTimelines[key].updatedAt > merged[key].updatedAt) {
                                merged[key] = remoteTimelines[key];
                            }
                        }
                    } else {
                        merged = remoteTimelines;
                    }

                    saveTimelines(merged);
                    
                    // Обновляем кэш в Timeline
                    updateTimelineCache(merged);

                    if (showNotify) notify(`📥 Загружено ${Object.keys(remoteTimelines).length} таймлайнов`);
                } catch(e) {
                    console.error('[TimelineSync] Parse error:', e);
                    if (showNotify) notify('❌ Ошибка чтения данных из Gist');
                }
            },
            error: function(xhr) {
                console.error('[TimelineSync] Error:', xhr);
                if (showNotify) notify('❌ Ошибка загрузки: ' + (xhr.responseJSON?.message || 'Unknown error'));
            }
        });
    }

    // ========= TIMELINE CORE =========
    function getVideoKey(url) {
        if (Lampa.Utils && Lampa.Utils.hash) {
            return Lampa.Utils.hash(url);
        }
        return 'v_' + url.replace(/[^a-zA-Z0-9]/g, '_').slice(-50);
    }

    function updateTimelineCache(data) {
        // Обновляем внутренний кэш Timeline
        const timelines = getTimelines();
        for (const key in timelines) {
            const tl = timelines[key];
            // Сохраняем в Storage для Timeline
            const fileView = Lampa.Storage.get(Lampa.Timeline.filename(), {});
            if (!fileView[key] || tl.updatedAt > (fileView[key]?.updatedAt || 0)) {
                fileView[key] = {
                    percent: tl.percent || 0,
                    time: tl.time || 0,
                    duration: tl.duration || 0,
                    profile: tl.profile || 0
                };
                Lampa.Storage.set(Lampa.Timeline.filename(), fileView, true);
            }
        }
        // Перечитываем Timeline
        Lampa.Timeline.read(true);
    }

    // ========= PLAYER EVENTS =========
    let syncTimeout = null;
    let currentVideoKey = null;
    let isPlayerActive = false;

    function onTimeUpdate(event) {
        const c = cfg();
        if (!c.sync_on_timeupdate) return;

        const playData = Lampa.Player.playdata();
        if (!playData || !playData.url) return;

        const videoKey = getVideoKey(playData.url);
        currentVideoKey = videoKey;

        // Debounce сохранения
        clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            saveCurrentTimeline();
        }, SYNC_DEBOUNCE_MS);
    }

    function saveCurrentTimeline() {
        const playData = Lampa.Player.playdata();
        if (!playData || !playData.url) return;

        const videoKey = getVideoKey(playData.url);
        const timeline = Lampa.Timeline.view(videoKey);
        
        if (!timeline || timeline.percent === undefined) return;

        const timelines = getTimelines();
        timelines[videoKey] = {
            percent: Math.round(timeline.percent),
            time: Math.round(timeline.time || 0),
            duration: Math.round(timeline.duration || 0),
            profile: timeline.profile || 0,
            url: playData.url,
            updatedAt: Date.now()
        };

        saveTimelines(timelines);

        // Автосинхронизация с Gist
        const c = cfg();
        if (c.gist_token && c.gist_id) {
            syncToGist(false);
        }
    }

    function onPlayerCreate(event) {
        isPlayerActive = true;
        
        // Подписываемся на обновления времени
        Lampa.Player.listener.follow('timeupdate', onTimeUpdate);
        Lampa.Player.listener.follow('destroy', onPlayerDestroy);

        // Пытаемся загрузить сохраненный прогресс
        const playData = Lampa.Player.playdata();
        if (playData && playData.url) {
            setTimeout(() => {
                loadTimelineForCurrentVideo();
            }, 1000);
        }
    }

    function onPlayerDestroy() {
        // Сохраняем финальный прогресс
        saveCurrentTimeline();
        
        isPlayerActive = false;
        Lampa.Player.listener.remove('timeupdate', onTimeUpdate);
        Lampa.Player.listener.remove('destroy', onPlayerDestroy);
    }

    function loadTimelineForCurrentVideo() {
        const playData = Lampa.Player.playdata();
        if (!playData || !playData.url) return;

        const videoKey = getVideoKey(playData.url);
        const timelines = getTimelines();
        
        if (timelines[videoKey] && timelines[videoKey].percent > 0) {
            const tl = timelines[videoKey];
            
            // Применяем к плееру через механизм Timeline
            if (playData.timeline) {
                playData.timeline.percent = tl.percent;
                playData.timeline.time = tl.time || 0;
                playData.timeline.duration = tl.duration || 0;
                playData.timeline.continued = false;
                console.log(`[TimelineSync] Restored: ${videoKey} - ${tl.percent}%`);
            }
        }
    }

    // ========= SETTINGS UI =========
    function showGistSetup() {
        const c = cfg();
        
        Lampa.Select.show({
            title: '☁️ Gist Синхронизация таймлайнов',
            items: [
                { 
                    title: `🔑 Токен: ${c.gist_token ? '✓ Установлен' : '❌ Не установлен'}`, 
                    action: 'token' 
                },
                { 
                    title: `📄 Gist ID: ${c.gist_id ? c.gist_id.substring(0, 8) + '…' : '❌ Не установлен'}`, 
                    action: 'id' 
                },
                { title: '──────────', separator: true },
                { title: '📤 Выгрузить в Gist', action: 'upload' },
                { title: '📥 Загрузить из Gist', action: 'download' },
                { title: '📥 Загрузить (заменить локальные)', action: 'download_replace' },
                { title: '──────────', separator: true },
                { title: '⚙️ События синхронизации →', action: 'events' },
                { title: '──────────', separator: true },
                { title: '❌ Отмена', action: 'cancel' }
            ],
            onSelect: (item) => {
                if (item.action === 'token') {
                    Lampa.Input.edit({
                        title: 'GitHub Personal Access Token',
                        value: c.gist_token,
                        free: true
                    }, (val) => {
                        if (val !== null) {
                            c.gist_token = val || '';
                            saveCfg(c);
                            notify('Токен сохранён');
                        }
                        showGistSetup();
                    });
                } else if (item.action === 'id') {
                    Lampa.Input.edit({
                        title: 'Gist ID',
                        value: c.gist_id,
                        free: true
                    }, (val) => {
                        if (val !== null) {
                            c.gist_id = val || '';
                            saveCfg(c);
                            notify('Gist ID сохранён');
                        }
                        showGistSetup();
                    });
                } else if (item.action === 'upload') {
                    syncToGist(true);
                    setTimeout(() => showGistSetup(), 1500);
                } else if (item.action === 'download') {
                    syncFromGist(true, true);
                    setTimeout(() => showGistSetup(), 1500);
                } else if (item.action === 'download_replace') {
                    syncFromGist(true, false);
                    setTimeout(() => showGistSetup(), 1500);
                } else if (item.action === 'events') {
                    showSyncEventsSetup();
                }
            },
            onBack: () => {
                Lampa.Controller.toggle('content');
            }
        });
    }

    function showSyncEventsSetup() {
        const c = cfg();
        
        Lampa.Select.show({
            title: '⚙️ События синхронизации',
            items: [
                { 
                    title: `🔄 При запуске Lampa: ${c.sync_on_start ? '✅ Вкл' : '❌ Выкл'}`, 
                    action: 'sync_on_start' 
                },
                { 
                    title: `🔄 При закрытии Lampa: ${c.sync_on_close ? '✅ Вкл' : '❌ Выкл'}`, 
                    action: 'sync_on_close' 
                },
                { 
                    title: `⏱ При обновлении времени: ${c.sync_on_timeupdate ? '✅ Вкл' : '❌ Выкл'}`, 
                    action: 'sync_on_timeupdate' 
                },
                { title: '──────────', separator: true },
                { 
                    title: `⏱ Автосинхронизация: ${c.sync_auto_interval ? '✅ Вкл' : '❌ Выкл'}`, 
                    action: 'sync_auto_interval' 
                },
                { 
                    title: `🕐 Интервал: ${c.sync_interval_minutes || 60} минут`, 
                    action: 'interval' 
                },
                { title: '──────────', separator: true },
                { title: '◀ Назад', action: 'back' }
            ],
            onSelect: (item) => {
                if (item.action === 'sync_on_start') {
                    c.sync_on_start = !c.sync_on_start;
                    saveCfg(c);
                    notify(`Синхронизация при запуске ${c.sync_on_start ? 'включена' : 'выключена'}`);
                    showSyncEventsSetup();
                } else if (item.action === 'sync_on_close') {
                    c.sync_on_close = !c.sync_on_close;
                    saveCfg(c);
                    notify(`Синхронизация при закрытии ${c.sync_on_close ? 'включена' : 'выключена'}`);
                    showSyncEventsSetup();
                } else if (item.action === 'sync_on_timeupdate') {
                    c.sync_on_timeupdate = !c.sync_on_timeupdate;
                    saveCfg(c);
                    notify(`Синхронизация по времени ${c.sync_on_timeupdate ? 'включена' : 'выключена'}`);
                    showSyncEventsSetup();
                } else if (item.action === 'sync_auto_interval') {
                    c.sync_auto_interval = !c.sync_auto_interval;
                    saveCfg(c);
                    if (c.sync_auto_interval) startAutoSync();
                    notify(`Автосинхронизация ${c.sync_auto_interval ? 'включена' : 'выключена'}`);
                    showSyncEventsSetup();
                } else if (item.action === 'interval') {
                    Lampa.Input.edit({
                        title: 'Интервал автосинхронизации (минуты)',
                        value: String(c.sync_interval_minutes || 60),
                        free: true
                    }, (val) => {
                        if (val !== null) {
                            const minutes = parseInt(val);
                            if (!isNaN(minutes) && minutes >= 5) {
                                c.sync_interval_minutes = minutes;
                                saveCfg(c);
                                notify(`Интервал установлен: ${minutes} минут`);
                            } else {
                                notify('Минимальный интервал 5 минут');
                            }
                        }
                        showSyncEventsSetup();
                    });
                } else if (item.action === 'back') {
                    showGistSetup();
                }
            },
            onBack: () => {
                showGistSetup();
            }
        });
    }

    // ========= AUTO SYNC =========
    let syncTimer = null;

    function checkAutoSync() {
        const c = cfg();
        if (!c.sync_auto_interval) return;
        
        const now = Date.now();
        const interval = (c.sync_interval_minutes || 60) * 60 * 1000;
        
        if (now - c.last_sync > interval) {
            syncToGist(false);
        }
    }

    function startAutoSync() {
        if (syncTimer) clearInterval(syncTimer);
        syncTimer = setInterval(() => checkAutoSync(), 5 * 60 * 1000);
    }

    // ========= SETTINGS API =========
    function settings() {
        Lampa.SettingsApi.addComponent({
            component: 'timeline_gist',
            name: 'Синхронизация таймлайнов',
            icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'tl_gist_button',
                type: 'button'
            },
            field: {
                name: 'GitHub Gist синхронизация',
                description: 'Настройка облачной синхронизации прогресса просмотра'
            },
            onChange: () => {
                showGistSetup();
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'tl_gist_force_sync',
                type: 'button'
            },
            field: {
                name: 'Принудительная синхронизация',
                description: 'Выгрузить текущие таймлайны в Gist'
            },
            onChange: () => {
                syncToGist(true);
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'timeline_gist',
            param: {
                name: 'tl_gist_clear_local',
                type: 'button'
            },
            field: {
                name: 'Очистить локальные таймлайны',
                description: 'Удалить все сохраненные прогрессы просмотра'
            },
            onChange: () => {
                Lampa.Select.show({
                    title: 'Удалить все таймлайны?',
                    items: [
                        { title: 'Нет', action: 'cancel' },
                        { title: 'Да', action: 'clear' }
                    ],
                    onSelect: (a) => {
                        if (a.action === 'clear') {
                            saveTimelines({});
                            // Очищаем Timeline
                            const fileView = Lampa.Storage.get(Lampa.Timeline.filename(), {});
                            for (const key in fileView) {
                                delete fileView[key];
                            }
                            Lampa.Storage.set(Lampa.Timeline.filename(), fileView, true);
                            Lampa.Timeline.read(true);
                            notify('Таймлайны очищены');
                        }
                    },
                    onBack: () => {
                        Lampa.Controller.toggle('content');
                    }
                });
            }
        });
    }

    // ========= APP EVENTS =========
    function onAppClose() {
        const c = cfg();
        if (c.sync_on_close && c.gist_token && c.gist_id) {
            syncToGist(false);
        }
    }

    function onAppStart() {
        const c = cfg();
        if (c.sync_on_start && c.gist_token && c.gist_id) {
            setTimeout(() => {
                syncFromGist(false, true);
            }, 3000);
        }
    }

    // ========= INIT =========
    function init() {
        const c = cfg();
        if (!c.enabled) return;

        console.log('[TimelineSync] Initialized');

        // Подписываемся на создание плеера
        Lampa.Player.listener.follow('create', onPlayerCreate);

        // Настройки
        settings();

        // Автосинхронизация
        startAutoSync();

        // События приложения
        onAppStart();
        window.addEventListener('beforeunload', onAppClose);

        // Загружаем сохраненные таймлайны в кэш
        setTimeout(() => {
            updateTimelineCache(getTimelines());
        }, 500);
    }

    // ========= START =========
    if (window.appready) {
        init();
    } else {
        Lampa.Listener.follow('app', (e) => {
            if (e.type === 'ready') init();
        });
    }

})();
