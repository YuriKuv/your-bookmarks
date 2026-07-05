(function() {
    'use strict';

    // --- Конфигурация ---
    const PLUGIN_NAME = 'gist_timeline_sync';
    const STORAGE_KEY = 'gist_timeline_sync_data';
    const GIST_API_URL = 'https://api.github.com/gists';
    const SYNC_DEBOUNCE_MS = 5000;
    const LOAD_DEBOUNCE_MS = 1000;

    // --- Вспомогательные функции ---
    function getConfig() {
        let config = Lampa.Storage.get(STORAGE_KEY);
        if (!config || typeof config !== 'object') {
            config = { token: '', gistId: '', lastSync: 0 };
            Lampa.Storage.set(STORAGE_KEY, config, true);
        }
        return config;
    }

    function saveConfig(config) {
        Lampa.Storage.set(STORAGE_KEY, config, true);
    }

    // --- Основной модуль плагина ---
    const GistTimelineSync = {
        config: null,
        syncTimeout: null,
        isLoading: false,
        isSaving: false,
        lastSavedState: {},
        settingsItems: null,

        init: function() {
            console.log('[GistSync] Plugin initialized.');
            this.config = getConfig();

            // Подписываемся на создание плеера
            Lampa.Player.listener.follow('create', this.onPlayerCreate.bind(this));

            // Добавляем пункт в настройки
            this.addSettingsItem();

            // Если есть Gist ID и токен, пробуем загрузить данные при старте приложения
            if (this.config.gistId && this.config.token) {
                setTimeout(() => {
                    this.loadFromGist(true);
                }, 3000);
            } else {
                console.log('[GistSync] No Gist ID or token found. Sync disabled.');
            }
        },

        onPlayerCreate: function(event) {
            const data = event.data;
            if (data && data.abort) {}

            Lampa.Player.listener.follow('timeupdate', this.onTimeUpdate.bind(this));
            Lampa.Player.listener.follow('destroy', this.onPlayerDestroy.bind(this));

            const playData = Lampa.Player.playdata();
            if (playData && playData.url) {
                clearTimeout(this._loadTimeout);
                this._loadTimeout = setTimeout(() => {
                    this.loadTimelineForCurrentVideo(playData);
                }, LOAD_DEBOUNCE_MS);
            }
        },

        onTimeUpdate: function(event) {
            const playData = Lampa.Player.playdata();
            if (!playData || !playData.url) return;

            clearTimeout(this.syncTimeout);
            this.syncTimeout = setTimeout(() => {
                this.saveCurrentTimeline(playData);
            }, SYNC_DEBOUNCE_MS);
        },

        onPlayerDestroy: function() {
            const playData = Lampa.Player.playdata();
            if (playData && playData.url) {
                this.saveCurrentTimeline(playData);
            }
            Lampa.Player.listener.remove('timeupdate', this.onTimeUpdate);
            Lampa.Player.listener.remove('destroy', this.onPlayerDestroy);
        },

        saveCurrentTimeline: function(playData) {
            if (this.isSaving) return;

            const url = playData.url;
            const videoKey = this.getVideoKey(url);

            const timeline = Lampa.Timeline.view(videoKey);
            if (!timeline || timeline.percent === undefined) return;

            const state = this.lastSavedState;
            state[videoKey] = {
                percent: timeline.percent,
                time: timeline.time,
                duration: timeline.duration,
                updatedAt: Date.now()
            };

            this.saveToGist();
        },

        loadTimelineForCurrentVideo: function(playData) {
            if (this.isLoading) return;

            const url = playData.url;
            const videoKey = this.getVideoKey(url);

            const cachedState = this.lastSavedState[videoKey];
            if (cachedState && cachedState.percent > 0) {
                this.applyTimeline(videoKey, cachedState);
                return;
            }

            if (this.config.gistId && this.config.token) {
                this.loadFromGist(false, (gistData) => {
                    if (gistData && gistData[videoKey]) {
                        this.applyTimeline(videoKey, gistData[videoKey]);
                    }
                });
            }
        },

        applyTimeline: function(videoKey, timelineData) {
            if (!timelineData || timelineData.percent === 0) return;

            const playData = Lampa.Player.playdata();
            if (!playData || this.getVideoKey(playData.url) !== videoKey) return;

            if (playData.timeline) {
                playData.timeline.percent = timelineData.percent;
                playData.timeline.time = timelineData.time || 0;
                playData.timeline.duration = timelineData.duration || 0;
                playData.timeline.continued = false;
                console.log(`[GistSync] Timeline applied for ${videoKey}: ${timelineData.percent}%`);
            }
        },

        saveToGist: function() {
            if (!this.config.token) {
                console.warn('[GistSync] No token provided. Cannot save.');
                return;
            }

            this.isSaving = true;
            const state = this.lastSavedState;
            const content = JSON.stringify(state, null, 2);

            const request = new Lampa.Request();
            const url = this.config.gistId
                ? `${GIST_API_URL}/${this.config.gistId}`
                : GIST_API_URL;

            const method = this.config.gistId ? 'PATCH' : 'POST';
            const data = {
                description: 'Lampa Timeline Sync',
                public: false,
                files: {
                    'timeline.json': {
                        content: content
                    }
                }
            };

            request.silent(
                url,
                (response) => {
                    this.isSaving = false;
                    if (response && response.id) {
                        if (!this.config.gistId) {
                            this.config.gistId = response.id;
                            saveConfig(this.config);
                            console.log(`[GistSync] New Gist created: ${this.config.gistId}`);
                        }
                        this.config.lastSync = Date.now();
                        saveConfig(this.config);
                        console.log('[GistSync] Timeline saved to Gist successfully.');
                    }
                },
                (error) => {
                    this.isSaving = false;
                    console.error('[GistSync] Failed to save to Gist:', error);
                    Lampa.Noty.show('Ошибка сохранения в Gist. Проверьте токен.');
                },
                JSON.stringify(data),
                {
                    headers: {
                        'Authorization': `token ${this.config.token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json'
                    }
                }
            );
        },

        loadFromGist: function(showNoty = false, callback = null) {
            if (!this.config.gistId || !this.config.token) {
                if (callback) callback(null);
                return;
            }

            this.isLoading = true;
            const request = new Lampa.Request();
            const url = `${GIST_API_URL}/${this.config.gistId}`;

            request.silent(
                url,
                (response) => {
                    this.isLoading = false;
                    if (response && response.files && response.files['timeline.json']) {
                        try {
                            const content = response.files['timeline.json'].content;
                            const data = JSON.parse(content);
                            for (const key in data) {
                                if (!this.lastSavedState[key] || data[key].updatedAt > this.lastSavedState[key].updatedAt) {
                                    this.lastSavedState[key] = data[key];
                                }
                            }
                            console.log('[GistSync] Timeline loaded from Gist successfully.');
                            if (showNoty) {
                                Lampa.Noty.show('Данные синхронизированы с Gist.');
                            }
                            if (callback) callback(data);
                        } catch (e) {
                            console.error('[GistSync] Failed to parse Gist content:', e);
                            if (showNoty) {
                                Lampa.Noty.show('Ошибка парсинга данных из Gist.');
                            }
                            if (callback) callback(null);
                        }
                    } else {
                        console.log('[GistSync] Gist exists but no timeline.json file found.');
                        if (callback) callback(null);
                    }
                },
                (error) => {
                    this.isLoading = false;
                    console.error('[GistSync] Failed to load from Gist:', error);
                    if (showNoty) {
                        Lampa.Noty.show('Ошибка загрузки из Gist. Проверьте токен.');
                    }
                    if (callback) callback(null);
                },
                null,
                {
                    headers: {
                        'Authorization': `token ${this.config.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );
        },

        getVideoKey: function(url) {
            if (window.Lampa && Lampa.Utils && Lampa.Utils.hash) {
                return Lampa.Utils.hash(url);
            }
            return 'v_' + url.replace(/[^a-zA-Z0-9]/g, '_').slice(-50);
        },

        // --- Исправленный интерфейс настроек ---
        addSettingsItem: function() {
            const self = this;

            // Ждем загрузки настроек
            if (Lampa.Settings && Lampa.Settings.listener) {
                Lampa.Settings.listener.follow('open', function(e) {
                    if (e.name === 'main') {
                        const body = e.body;
                        
                        // Удаляем старые элементы, если они есть
                        body.find('[data-name="gist_sync_main"]').remove();
                        body.find('[data-name="gist_sync_token"]').remove();
                        body.find('[data-name="gist_sync_id"]').remove();
                        body.find('[data-name="gist_sync_force"]').remove();

                        // Создаем группу параметров
                        const groupHtml = `
                            <div class="settings-param-title"><span>Синхронизация Gist</span></div>
                            
                            <div class="settings-param selector" data-type="input" data-name="gist_sync_token" data-children="gist_sync">
                                <div class="settings-param__name">Токен GitHub</div>
                                <div class="settings-param__value"></div>
                                <div class="settings-param__descr">Введите ваш Personal Access Token</div>
                            </div>
                            
                            <div class="settings-param selector" data-type="input" data-name="gist_sync_id" data-children="gist_sync">
                                <div class="settings-param__name">Gist ID</div>
                                <div class="settings-param__value"></div>
                                <div class="settings-param__descr">ID существующего Gist (оставьте пустым для создания)</div>
                            </div>
                            
                            <div class="settings-param selector" data-type="button" data-name="gist_sync_force" data-static="true">
                                <div class="settings-param__name">Принудительная синхронизация</div>
                                <div class="settings-param__value"></div>
                                <div class="settings-param__descr">Загрузить данные из Gist сейчас</div>
                            </div>
                        `;

                        // Вставляем после раздела "Интерфейс" или в начало
                        const interfaceSection = body.find('.settings-param-title:contains("Интерфейс")');
                        if (interfaceSection.length) {
                            interfaceSection.after(groupHtml);
                        } else {
                            // Если раздела "Интерфейс" нет, вставляем в начало
                            body.prepend(groupHtml);
                        }

                        // Обработчики для ввода
                        body.find('[data-name="gist_sync_token"]').on('hover:enter', function() {
                            self.showTokenDialog();
                        });

                        body.find('[data-name="gist_sync_id"]').on('hover:enter', function() {
                            self.showGistIdDialog();
                        });

                        body.find('[data-name="gist_sync_force"]').on('hover:enter', function() {
                            self.loadFromGist(true);
                        });

                        // Обновляем отображение значений
                        self.updateSettingsDisplay(body);
                    }
                });

                // Обновляем отображение при изменении конфига
                Lampa.Storage.listener.follow('change', function(e) {
                    if (e.name === STORAGE_KEY) {
                        self.config = getConfig();
                        const settingsBody = $('.settings__body');
                        if (settingsBody.length) {
                            self.updateSettingsDisplay(settingsBody);
                        }
                    }
                });
            } else {
                console.warn('[GistSync] Lampa.Settings not ready yet.');
            }
        },

        updateSettingsDisplay: function(body) {
            const tokenField = body.find('[data-name="gist_sync_token"] .settings-param__value');
            const idField = body.find('[data-name="gist_sync_id"] .settings-param__value');
            
            if (tokenField.length) {
                tokenField.text(this.config.token ? '****' + this.config.token.slice(-4) : 'Не установлен');
            }
            if (idField.length) {
                idField.text(this.config.gistId || 'Не создан');
            }
        },

        // Диалог для ввода токена
        showTokenDialog: function() {
            const self = this;
            
            Lampa.Select.show({
                title: 'Введите токен GitHub',
                items: [
                    {
                        title: 'Токен:',
                        type: 'input',
                        value: this.config.token || '',
                        placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxx'
                    }
                ],
                onSelect: function(item, index) {
                    if (index === 0) {
                        const newToken = item.value || '';
                        if (newToken !== self.config.token) {
                            self.config.token = newToken;
                            saveConfig(self.config);
                            Lampa.Noty.show('Токен обновлен');
                            
                            // Обновляем отображение
                            const settingsBody = $('.settings__body');
                            if (settingsBody.length) {
                                self.updateSettingsDisplay(settingsBody);
                            }
                        }
                    }
                },
                onBack: function() {
                    // Закрываем
                }
            });
        },

        // Диалог для ввода Gist ID
        showGistIdDialog: function() {
            const self = this;
            
            Lampa.Select.show({
                title: 'Введите ID Gist',
                items: [
                    {
                        title: 'Gist ID:',
                        type: 'input',
                        value: this.config.gistId || '',
                        placeholder: 'a1b2c3d4e5f6g7h8i9j0'
                    }
                ],
                onSelect: function(item, index) {
                    if (index === 0) {
                        const newId = item.value || '';
                        if (newId !== self.config.gistId) {
                            self.config.gistId = newId;
                            saveConfig(self.config);
                            Lampa.Noty.show('Gist ID обновлен');
                            
                            const settingsBody = $('.settings__body');
                            if (settingsBody.length) {
                                self.updateSettingsDisplay(settingsBody);
                            }
                        }
                    }
                },
                onBack: function() {
                    // Закрываем
                }
            });
        }
    };

    // --- Регистрация плагина ---
    if (typeof Lampa !== 'undefined' && Lampa.Player && Lampa.Storage) {
        if (Lampa.Plugin) {
            Lampa.Plugin.add({
                name: PLUGIN_NAME,
                init: GistTimelineSync.init.bind(GistTimelineSync)
            });
        } else {
            console.warn('[GistSync] Lampa.Plugin not found. Starting manually.');
            GistTimelineSync.init();
        }
    } else {
        console.error('[GistSync] Lampa core not fully loaded.');
    }

})();
