(function() {
    'use strict';

    // --- Конфигурация ---
    const PLUGIN_NAME = 'gist_timeline_sync';
    const STORAGE_KEY = 'gist_timeline_sync_data';
    const GIST_API_URL = 'https://api.github.com/gists';
    const SYNC_DEBOUNCE_MS = 5000; // Сохраняем на диск не чаще 5 секунд
    const LOAD_DEBOUNCE_MS = 1000; // Ждем 1 секунду после старта плеера для загрузки

    // --- Вспомогательные функции ---
    function getConfig() {
        // Загружаем конфиг из Storage. Если его нет, создаем дефолтный.
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

        // Инициализация плагина
        init: function() {
            console.log('[GistSync] Plugin initialized.');
            this.config = getConfig();

            // Подписываемся на создание плеера
            Lampa.Player.listener.follow('create', this.onPlayerCreate.bind(this));

            // Добавляем пункт в настройки
            this.addSettingsItem();

            // Если есть Gist ID и токен, пробуем загрузить данные при старте приложения
            if (this.config.gistId && this.config.token) {
                // Небольшая задержка, чтобы дать приложению полностью загрузиться
                setTimeout(() => {
                    this.loadFromGist(true);
                }, 3000);
            } else {
                console.log('[GistSync] No Gist ID or token found. Sync disabled.');
            }
        },

        // Обработчик создания плеера
        onPlayerCreate: function(event) {
            const data = event.data;
            // Сохраняем callback для отмены, если он есть
            if (data && data.abort) {
                // Не прерываем создание плеера
            }

            // Подписываемся на события плеера
            Lampa.Player.listener.follow('timeupdate', this.onTimeUpdate.bind(this));
            Lampa.Player.listener.follow('destroy', this.onPlayerDestroy.bind(this));

            // Пытаемся загрузить прогресс для текущего видео
            const playData = Lampa.Player.playdata();
            if (playData && playData.url) {
                // Небольшая задержка, чтобы плеер точно запустился
                clearTimeout(this._loadTimeout);
                this._loadTimeout = setTimeout(() => {
                    this.loadTimelineForCurrentVideo(playData);
                }, LOAD_DEBOUNCE_MS);
            }
        },

        // Обработчик обновления времени
        onTimeUpdate: function(event) {
            const playData = Lampa.Player.playdata();
            if (!playData || !playData.url) return;

            // Используем debounce для сохранения
            clearTimeout(this.syncTimeout);
            this.syncTimeout = setTimeout(() => {
                this.saveCurrentTimeline(playData);
            }, SYNC_DEBOUNCE_MS);
        },

        // Обработчик закрытия плеера
        onPlayerDestroy: function() {
            // Сохраняем финальный прогресс при закрытии
            const playData = Lampa.Player.playdata();
            if (playData && playData.url) {
                this.saveCurrentTimeline(playData);
            }
            // Отписываемся от событий, чтобы избежать утечек памяти
            Lampa.Player.listener.remove('timeupdate', this.onTimeUpdate);
            Lampa.Player.listener.remove('destroy', this.onPlayerDestroy);
        },

        // Сохранение текущего таймлайна
        saveCurrentTimeline: function(playData) {
            if (this.isSaving) return;

            const url = playData.url;
            // Генерируем уникальный ключ для видео (можно использовать хеш от URL)
            const videoKey = this.getVideoKey(url);

            // Получаем текущий прогресс из Timeline
            const timeline = Lampa.Timeline.view(videoKey);
            if (!timeline || timeline.percent === undefined) return;

            // Сохраняем в локальный кэш
            const state = this.lastSavedState;
            state[videoKey] = {
                percent: timeline.percent,
                time: timeline.time,
                duration: timeline.duration,
                updatedAt: Date.now()
            };

            // Запускаем сохранение в Gist
            this.saveToGist();
        },

        // Загрузка таймлайна для текущего видео
        loadTimelineForCurrentVideo: function(playData) {
            if (this.isLoading) return;

            const url = playData.url;
            const videoKey = this.getVideoKey(url);

            // Сначала проверяем локальный кэш
            const cachedState = this.lastSavedState[videoKey];
            if (cachedState && cachedState.percent > 0) {
                this.applyTimeline(videoKey, cachedState);
                return;
            }

            // Если нет в кэше, загружаем из Gist (если есть ID)
            if (this.config.gistId && this.config.token) {
                this.loadFromGist(false, (gistData) => {
                    if (gistData && gistData[videoKey]) {
                        this.applyTimeline(videoKey, gistData[videoKey]);
                    }
                });
            }
        },

        // Применить сохраненный прогресс к плееру
        applyTimeline: function(videoKey, timelineData) {
            if (!timelineData || timelineData.percent === 0) return;

            const playData = Lampa.Player.playdata();
            if (!playData || this.getVideoKey(playData.url) !== videoKey) return;

            // Используем механизм Timeline для восстановления
            // Создаем объект, который подхватит плеер при продолжении
            if (playData.timeline) {
                playData.timeline.percent = timelineData.percent;
                playData.timeline.time = timelineData.time || 0;
                playData.timeline.duration = timelineData.duration || 0;
                playData.timeline.continued = false; // Заставляем плеер применить
                console.log(`[GistSync] Timeline applied for ${videoKey}: ${timelineData.percent}%`);
            }
        },

        // --- Работа с Gist API ---

        // Сохранить состояние в Gist
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

        // Загрузить состояние из Gist
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
                            // Обновляем локальный кэш, но не перезаписываем более новые данные
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

        // --- Вспомогательные функции ---

        // Генерация ключа для видео (простой хеш от URL)
        getVideoKey: function(url) {
            // Простой способ: берем последние 50 символов URL, чтобы не было слишком длинно
            // Или можно использовать Lampa.Utils.hash, если он доступен
            if (window.Lampa && Lampa.Utils && Lampa.Utils.hash) {
                return Lampa.Utils.hash(url);
            }
            // fallback
            return 'v_' + url.replace(/[^a-zA-Z0-9]/g, '_').slice(-50);
        },

        // --- Интерфейс ---

        // Добавить пункт в настройки
        addSettingsItem: function() {
            const self = this;

            // Ждем, пока загрузится интерфейс настроек
            if (Lampa.Settings && Lampa.Settings.listener) {
                Lampa.Settings.listener.follow('open', function(e) {
                    if (e.name === 'more' || e.name === 'main') {
                        const body = e.body;
                        // Проверяем, не добавлен ли уже пункт
                        if (body.find('.settings-param[data-name="gist_sync"]').length > 0) return;

                        const itemHtml = `
                            <div class="settings-param selector" data-type="button" data-name="gist_sync" data-static="true">
                                <div class="settings-param__name">Синхронизация Gist</div>
                                <div class="settings-param__value"></div>
                                <div class="settings-param__descr">Настройка синхронизации прогресса через Gist</div>
                            </div>
                            <div class="settings-param selector" data-type="button" data-name="gist_sync_force" data-static="true">
                                <div class="settings-param__name">Принудительная синхронизация</div>
                                <div class="settings-param__value"></div>
                                <div class="settings-param__descr">Загрузить данные из Gist сейчас</div>
                            </div>
                        `;

                        // Вставляем после раздела "Дополнительно" (more) или в конец
                        const moreSection = body.find('.settings-param-title:contains("Дополнительно")');
                        if (moreSection.length) {
                            moreSection.after(itemHtml);
                        } else {
                            body.append(itemHtml);
                        }

                        // Обработчики
                        body.find('[data-name="gist_sync"]').on('hover:enter', function() {
                            self.showConfigDialog();
                        });

                        body.find('[data-name="gist_sync_force"]').on('hover:enter', function() {
                            self.loadFromGist(true);
                        });
                    }
                });
            } else {
                console.warn('[GistSync] Lampa.Settings not ready yet.');
            }
        },

        // Показать диалог настройки
        showConfigDialog: function() {
            const self = this;
            const config = this.config;

            Lampa.Select.show({
                title: 'Настройка Gist Sync',
                items: [
                    {
                        title: 'Токен GitHub: ' + (config.token ? '****' + config.token.slice(-4) : 'Не установлен'),
                        type: 'input',
                        value: config.token || '',
                        placeholder: 'Введите ваш GitHub токен'
                    },
                    {
                        title: 'Gist ID: ' + (config.gistId || 'Не создан'),
                        type: 'input',
                        value: config.gistId || '',
                        placeholder: 'ID существующего Gist (оставьте пустым для создания)'
                    },
                    {
                        title: 'Сохранить и синхронизировать'
                    }
                ],
                onSelect: function(item, index) {
                    if (index === 0) {
                        // Токен
                        const newToken = item.value || '';
                        if (newToken !== config.token) {
                            config.token = newToken;
                            saveConfig(config);
                            Lampa.Noty.show('Токен обновлен');
                        }
                    } else if (index === 1) {
                        // Gist ID
                        const newGistId = item.value || '';
                        if (newGistId !== config.gistId) {
                            config.gistId = newGistId;
                            saveConfig(config);
                            Lampa.Noty.show('Gist ID обновлен');
                        }
                    } else if (index === 2) {
                        // Сохранить
                        if (!config.token) {
                            Lampa.Noty.show('Необходимо указать токен GitHub');
                            return;
                        }
                        // Принудительно сохраняем текущее состояние
                        const playData = Lampa.Player.playdata();
                        if (playData) {
                            self.saveCurrentTimeline(playData);
                        } else {
                            // Если плеер не активен, просто сохраняем то, что есть в кэше
                            self.saveToGist();
                        }
                        // Пытаемся загрузить
                        setTimeout(() => {
                            self.loadFromGist(true);
                        }, 2000);
                    }
                    // Переоткрываем диалог, если не последний пункт
                    if (index < 2) {
                        setTimeout(() => self.showConfigDialog(), 300);
                    }
                },
                onBack: function() {
                    // Закрываем диалог
                },
                onInput: function(item, index, value) {
                    // Обновляем отображение
                }
            });
        }
    };

    // --- Регистрация плагина ---
    // Проверяем, что Lampa и его компоненты загружены
    if (typeof Lampa !== 'undefined' && Lampa.Player && Lampa.Storage) {
        // Добавляем плагин в список плагинов Lampa (если есть такая возможность)
        if (Lampa.Plugin) {
            Lampa.Plugin.add({
                name: PLUGIN_NAME,
                init: GistTimelineSync.init.bind(GistTimelineSync)
            });
        } else {
            // Если Lampa.Plugin не существует, запускаем инициализацию вручную
            console.warn('[GistSync] Lampa.Plugin not found. Starting manually.');
            GistTimelineSync.init();
        }
    } else {
        console.error('[GistSync] Lampa core not fully loaded.');
    }

})();
