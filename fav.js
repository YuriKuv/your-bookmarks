(function() {
    'use strict';

    // ============== ПРОВЕРКА ПЛАТФОРМЫ ==============
    if (typeof Lampa === 'undefined') {
        console.error('Lampa не найдена');
        return;
    }

    Lampa.Platform.tv();

    // ============== КОНФИГУРАЦИЯ ==============
    const PLUGIN_NAME = 'custom_favorites_sync';
    const STORAGE_KEY = 'custom_favorites_sync_config';
    const GIST_API = 'https://api.github.com/gists';
    const SYNC_INTERVAL = 60000;
    const SAVE_DELAY = 2000;
    const DEBUG = true;

    // ============== ЛОГГИРОВАНИЕ ==============
    function log() {
        if (DEBUG) {
            console.log.apply(console, ['[CustomFavoritesSync]'].concat(Array.from(arguments)));
        }
    }

    function logError() {
        console.error.apply(console, ['[CustomFavoritesSync] ERROR:'].concat(Array.from(arguments)));
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

    // ============== ХРАНИЛИЩЕ КОНФИГА ==============
    function getConfig() {
        return Lampa.Storage.get(STORAGE_KEY, {
            token: '',
            gistId: '',
            lastSync: 0,
            enabled: true,
            autoSync: true,
            folders: []
        });
    }

    function saveConfig(cfg) {
        Lampa.Storage.set(STORAGE_KEY, cfg);
    }

    function notify(text) {
        try {
            Lampa.Noty.show(text);
        } catch(e) {
            console.log('[CustomFavoritesSync]', text);
        }
    }

    // ============== РАБОТА С ПОЛЬЗОВАТЕЛЬСКИМИ ПАПКАМИ ==============
    const FolderManager = {
        getData() {
            return Lampa.Storage.get('custom_favorites_data', {
                folders: {},
                items: {}
            });
        },

        saveData(data) {
            Lampa.Storage.set('custom_favorites_data', data);
        },

        createFolder(name) {
            const data = this.getData();
            if (data.folders[name]) {
                throw new Error('Папка с таким именем уже существует');
            }
            const id = Lampa.Utils.uid ? Lampa.Utils.uid() : Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            data.folders[name] = id;
            data.items[id] = [];
            this.saveData(data);
            return { name, id, count: 0 };
        },

        renameFolder(oldName, newName) {
            const data = this.getData();
            if (!data.folders[oldName]) {
                throw new Error('Папка не найдена');
            }
            if (data.folders[newName]) {
                throw new Error('Папка с таким именем уже существует');
            }
            const id = data.folders[oldName];
            delete data.folders[oldName];
            data.folders[newName] = id;
            this.saveData(data);
            return true;
        },

        deleteFolder(name) {
            const data = this.getData();
            if (!data.folders[name]) {
                throw new Error('Папка не найдена');
            }
            const id = data.folders[name];
            delete data.folders[name];
            delete data.items[id];
            this.saveData(data);
            return true;
        },

        getFolderId(name) {
            const data = this.getData();
            return data.folders[name] || null;
        },

        getFolderItems(name) {
            const data = this.getData();
            const id = data.folders[name];
            if (!id) return [];
            return data.items[id] || [];
        },

        toggleCard(folderName, card) {
            const data = this.getData();
            const id = data.folders[folderName];
            if (!id) {
                throw new Error('Папка не найдена');
            }
            const items = data.items[id] || [];
            const index = items.findIndex(item => item.id === card.id);
            
            if (index === -1) {
                // Добавляем в начало
                const cleanCard = Lampa.Arrays.clone ? Lampa.Arrays.clone(card) : Object.assign({}, card);
                if (Lampa.Utils && Lampa.Utils.clearCard) {
                    Object.assign(cleanCard, Lampa.Utils.clearCard(card));
                }
                items.unshift(cleanCard);
            } else {
                items.splice(index, 1);
            }
            
            data.items[id] = items;
            this.saveData(data);
            
            // Обновляем UI
            Lampa.Listener.send('state:changed', {
                target: 'custom_favorites',
                reason: 'update',
                folder: folderName,
                card: card
            });
            
            return { name: folderName, id, count: items.length };
        },

        getAllFolders() {
            const data = this.getData();
            return Object.keys(data.folders).map(name => ({
                name: name,
                id: data.folders[name],
                count: (data.items[data.folders[name]] || []).length
            }));
        },

        getCardsByFolder(name) {
            return this.getFolderItems(name);
        }
    };

    // ============== GIST СИНХРОНИЗАЦИЯ ==============
    const SyncManager = {
        isSyncing: false,
        syncTimer: null,

        getAllTimelines() {
            const allTimelines = {};
            const now = Date.now();
            const keys = ['file_view'];
            const profileId = getProfileId();
            if (profileId) {
                keys.push('file_view_' + profileId);
            }
            
            // Добавляем все таймлайны
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('nsl_timeline_')) {
                    if (!keys.includes(k)) {
                        keys.push(k);
                    }
                }
            }
            
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
                                        updatedAt: updated
                                    };
                                }
                            } else {
                                allTimelines[hash] = {
                                    time: Math.round(item.time),
                                    duration: Math.round(item.duration || 0),
                                    percent: Math.round(item.percent || 0),
                                    updatedAt: updated
                                };
                            }
                        }
                    }
                } catch(e) {
                    logError('Error reading timeline:', key, e);
                }
            });
            
            return allTimelines;
        },

        getAllData() {
            const folders = FolderManager.getAllFolders();
            const folderData = {};
            folders.forEach(f => {
                folderData[f.name] = FolderManager.getFolderItems(f.name);
            });
            
            return {
                version: 2,
                profile: getProfileId() || 'default',
                updated: new Date().toISOString(),
                folders: folderData,
                timelines: this.getAllTimelines(),
                bookmarks: this.getBookmarks()
            };
        },

        getBookmarks() {
            try {
                const fav = Lampa.Storage.get('favorite', {});
                const result = {};
                ['book', 'like', 'wath', 'history', 'viewed', 'scheduled', 'continued', 'thrown'].forEach(type => {
                    if (fav[type]) {
                        result[type] = fav[type];
                    }
                });
                return result;
            } catch(e) {
                return {};
            }
        },

        saveAllData(data) {
            try {
                // Сохраняем папки
                if (data.folders) {
                    const foldersData = { folders: {}, items: {} };
                    const currentData = FolderManager.getData();
                    
                    Object.keys(data.folders).forEach(name => {
                        const id = currentData.folders[name] || Lampa.Utils.uid ? Lampa.Utils.uid() : Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
                        foldersData.folders[name] = id;
                        foldersData.items[id] = data.folders[name] || [];
                    });
                    
                    Object.assign(currentData.folders, foldersData.folders);
                    Object.assign(currentData.items, foldersData.items);
                    FolderManager.saveData(currentData);
                }
                
                // Сохраняем таймлайны
                if (data.timelines) {
                    const keys = ['file_view'];
                    const profileId = getProfileId();
                    if (profileId) {
                        keys.push('file_view_' + profileId);
                    }
                    
                    keys.forEach(key => {
                        try {
                            const existing = Lampa.Storage.get(key, {});
                            let changed = false;
                            for (const hash in data.timelines) {
                                const remote = data.timelines[hash];
                                const local = existing[hash];
                                if (!local || (remote.updatedAt || 0) > (local.updated || 0)) {
                                    existing[hash] = {
                                        time: remote.time,
                                        duration: remote.duration || 0,
                                        percent: remote.percent || 0,
                                        updated: remote.updatedAt || Date.now()
                                    };
                                    changed = true;
                                }
                            }
                            if (changed) {
                                Lampa.Storage.set(key, existing);
                            }
                        } catch(e) {
                            logError('Error saving timelines to', key, e);
                        }
                    });
                    
                    // Обновляем UI
                    this.forceUIUpdate();
                }
                
                // Сохраняем закладки
                if (data.bookmarks) {
                    const fav = Lampa.Storage.get('favorite', {});
                    let changed = false;
                    Object.keys(data.bookmarks).forEach(type => {
                        if (Array.isArray(data.bookmarks[type])) {
                            fav[type] = data.bookmarks[type];
                            changed = true;
                        }
                    });
                    if (changed) {
                        Lampa.Storage.set('favorite', fav);
                    }
                }
                
            } catch(e) {
                logError('Error saving data:', e);
            }
        },

        forceUIUpdate() {
            try {
                // Обновляем таймлайны в UI
                if (Lampa.Timeline && typeof Lampa.Timeline.render === 'function') {
                    Lampa.Timeline.render();
                }
                
                // Отправляем событие обновления
                Lampa.Listener.send('state:changed', {
                    target: 'custom_favorites',
                    reason: 'sync_complete'
                });
            } catch(e) {
                logError('UI update error:', e);
            }
        },

        syncToGist(showNotify = true) {
            const cfg = getConfig();
            if (!cfg.token || !cfg.gistId) {
                if (showNotify) notify('⚠️ GitHub Gist не настроен');
                return false;
            }

            if (this.isSyncing) {
                if (showNotify) notify('⏳ Синхронизация уже выполняется');
                return false;
            }

            this.isSyncing = true;
            const data = this.getAllData();
            const count = Object.keys(data.folders || {}).length + 
                         Object.keys(data.timelines || {}).length;

            log('SYNC TO GIST:', count, 'items');

            const payload = {
                description: 'Lampa Custom Favorites Sync',
                public: false,
                files: {
                    'favorites_data.json': {
                        content: JSON.stringify(data, null, 2)
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
                body: JSON.stringify(payload)
            })
            .then(response => {
                if (!response.ok) {
                    throw { status: response.status, statusText: response.statusText };
                }
                return response.json();
            })
            .then(() => {
                cfg.lastSync = Date.now();
                saveConfig(cfg);
                if (showNotify) notify('✅ Синхронизация завершена');
                log('Sync complete');
            })
            .catch(err => {
                logError('Sync error:', err.status || 'unknown');
                if (err.status === 404) {
                    this.createNewGist(showNotify);
                } else {
                    if (showNotify) notify('❌ Ошибка синхронизации: ' + (err.status || 'unknown'));
                }
            })
            .finally(() => {
                this.isSyncing = false;
            });

            return true;
        },

        createNewGist(showNotify = true) {
            const cfg = getConfig();
            const data = this.getAllData();

            const payload = {
                description: 'Lampa Custom Favorites Sync',
                public: false,
                files: {
                    'favorites_data.json': {
                        content: JSON.stringify(data, null, 2)
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
                body: JSON.stringify(payload)
            })
            .then(response => {
                if (!response.ok) {
                    throw { status: response.status, statusText: response.statusText };
                }
                return response.json();
            })
            .then(response => {
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
            .catch(err => {
                logError('Create Gist error:', err.status || 'unknown');
                if (showNotify) notify('❌ Ошибка создания Gist: ' + (err.status || 'unknown'));
            });
        },

        syncFromGist(showNotify = true) {
            const cfg = getConfig();
            if (!cfg.token || !cfg.gistId) {
                if (showNotify) notify('⚠️ GitHub Gist не настроен');
                return false;
            }

            if (this.isSyncing) {
                if (showNotify) notify('⏳ Синхронизация уже выполняется');
                return false;
            }

            this.isSyncing = true;
            log('LOADING from Gist...');

            const url = GIST_API + '/' + cfg.gistId;
            
            fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': 'token ' + cfg.token,
                    'Accept': 'application/vnd.github.v3+json'
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw { status: response.status, statusText: response.statusText };
                }
                return response.json();
            })
            .then(data => {
                try {
                    const content = data.files && data.files['favorites_data.json'] ? data.files['favorites_data.json'].content : null;
                    
                    if (!content) {
                        if (showNotify) notify('⚠️ Файл favorites_data.json не найден');
                        return;
                    }

                    const remote = JSON.parse(content);
                    this.saveAllData(remote);
                    
                    cfg.lastSync = Date.now();
                    saveConfig(cfg);
                    
                    if (showNotify) notify('✅ Данные загружены из Gist');
                    log('Load complete');
                } catch(e) {
                    logError('Parse error:', e);
                    if (showNotify) notify('❌ Ошибка чтения данных');
                }
            })
            .catch(err => {
                logError('Load error:', err.status || 'unknown');
                if (err.status === 404) {
                    if (showNotify) notify('❌ Gist не найден (404)');
                } else {
                    if (showNotify) notify('❌ Ошибка загрузки: ' + (err.status || 'unknown'));
                }
            })
            .finally(() => {
                this.isSyncing = false;
            });

            return true;
        },

        scheduleSync() {
            clearTimeout(this.syncTimer);
            this.syncTimer = setTimeout(() => {
                const cfg = getConfig();
                if (cfg.token && cfg.gistId && cfg.autoSync && !this.isSyncing) {
                    this.syncToGist(false);
                }
            }, SAVE_DELAY);
        },

        startPeriodicSync() {
            setInterval(() => {
                const cfg = getConfig();
                if (cfg.token && cfg.gistId && cfg.autoSync && !this.isSyncing) {
                    log('Periodic sync');
                    this.syncToGist(false);
                }
            }, SYNC_INTERVAL);
        }
    };

    // ============== UI КОМПОНЕНТЫ ==============
    const UI = {
        // Рендер папки избранного
        renderFolder(folder) {
            const id = 'folder-' + folder.id;
            const el = document.createElement('div');
            el.className = 'bookmarks-folder card selector layer--visible layer--render';
            el.dataset.folder = folder.name;
            el.innerHTML = `
                <div class="bookmarks-folder__inner card__view">
                    <div class="bookmarks-folder__layer">
                        <div class="bookmarks-folder__head">
                            <div class="bookmarks-folder__title">${folder.name}</div>
                            <div class="bookmarks-folder__num">${folder.count || 0}</div>
                        </div>
                        <div class="bookmarks-folder__body"></div>
                    </div>
                </div>
            `;
            
            // Добавляем карточки (до 3 штук)
            const items = FolderManager.getFolderItems(folder.name);
            const body = el.querySelector('.bookmarks-folder__body');
            const preview = items.slice(0, 3);
            
            preview.forEach((card, index) => {
                const img = document.createElement('img');
                img.className = 'card__img i-' + index;
                const poster = card.poster_path || card.img || card.poster;
                img.src = poster ? 
                    (Lampa.Api && Lampa.Api.img ? Lampa.Api.img(poster) : poster) : 
                    './img/img_load.svg';
                img.onload = function() {
                    this.classList.add('card--loaded');
                };
                img.onerror = function() {
                    this.src = './img/img_broken.svg';
                };
                body.appendChild(img);
            });
            
            if (preview.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty-folder-preview';
                empty.textContent = 'Пусто';
                body.appendChild(empty);
            }
            
            // Обработчики событий
            el.addEventListener('hover:enter', function(e) {
                Lampa.Activity.push({
                    url: '',
                    component: 'custom_favorites',
                    title: folder.name,
                    folder: folder.name,
                    page: 1
                });
            });
            
            el.addEventListener('hover:focus', function(e) {
                // Смена фона
                const firstCard = items[0];
                if (firstCard && Lampa.Background) {
                    Lampa.Background.change(firstCard.poster_path || firstCard.backdrop_path || firstCard.img);
                }
            });
            
            el.addEventListener('hover:long', function(e) {
                UI.showFolderMenu(folder.name, el);
            });
            
            return el;
        },

        // Меню папки
        showFolderMenu(folderName, element) {
            const items = [
                {
                    title: 'Переименовать',
                    action: 'rename'
                },
                {
                    title: 'Удалить',
                    action: 'delete'
                }
            ];
            
            try {
                Lampa.Select.show({
                    title: folderName,
                    items: items,
                    onSelect: (item) => {
                        if (item.action === 'rename') {
                            Lampa.Input.edit({
                                title: 'Новое имя папки',
                                value: folderName,
                                free: true,
                                nosave: true
                            }, (value) => {
                                if (value && value !== folderName) {
                                    try {
                                        FolderManager.renameFolder(folderName, value);
                                        if (element) {
                                            const title = element.querySelector('.bookmarks-folder__title');
                                            if (title) title.textContent = value;
                                            element.dataset.folder = value;
                                        }
                                        notify('✅ Папка переименована');
                                        UI.refreshBookmarks();
                                    } catch(e) {
                                        notify('❌ ' + e.message);
                                    }
                                }
                            });
                        } else if (item.action === 'delete') {
                            Lampa.Select.show({
                                title: 'Удалить папку "' + folderName + '"?',
                                items: [
                                    { title: 'Да, удалить', action: 'confirm' },
                                    { title: 'Отмена', action: 'cancel' }
                                ],
                                onSelect: (sub) => {
                                    if (sub.action === 'confirm') {
                                        try {
                                            FolderManager.deleteFolder(folderName);
                                            if (element) element.remove();
                                            notify('✅ Папка удалена');
                                            UI.refreshBookmarks();
                                        } catch(e) {
                                            notify('❌ ' + e.message);
                                        }
                                    }
                                }
                            });
                        }
                    }
                });
            } catch(e) {
                // Fallback
                const choice = confirm('Действия с папкой "' + folderName + '":\n1 - Переименовать\n2 - Удалить');
                if (choice === true) {
                    const newName = prompt('Новое имя папки:', folderName);
                    if (newName && newName !== folderName) {
                        try {
                            FolderManager.renameFolder(folderName, newName);
                            if (element) {
                                const title = element.querySelector('.bookmarks-folder__title');
                                if (title) title.textContent = newName;
                                element.dataset.folder = newName;
                            }
                            notify('✅ Папка переименована');
                            UI.refreshBookmarks();
                        } catch(e) {
                            notify('❌ ' + e.message);
                        }
                    }
                } else if (choice === false) {
                    if (confirm('Удалить папку "' + folderName + '"?')) {
                        try {
                            FolderManager.deleteFolder(folderName);
                            if (element) element.remove();
                            notify('✅ Папка удалена');
                            UI.refreshBookmarks();
                        } catch(e) {
                            notify('❌ ' + e.message);
                        }
                    }
                }
            }
        },

        // Кнопка добавления папки
        renderAddButton() {
            const el = document.createElement('div');
            el.className = 'bookmarks-folder card selector layer--visible layer--render new-custom-type';
            el.innerHTML = `
                <div class="bookmarks-folder__inner card__view">
                    <div class="bookmarks-folder__layer">
                        <div class="bookmarks-folder__head">
                            <div class="bookmarks-folder__title">+ Создать папку</div>
                            <div class="bookmarks-folder__num"><img src="./img/icons/add.svg"/></div>
                        </div>
                        <div class="bookmarks-folder__body"></div>
                    </div>
                </div>
            `;
            
            el.addEventListener('hover:enter', function() {
                Lampa.Input.edit({
                    title: 'Название папки',
                    value: '',
                    free: true,
                    nosave: true
                }, (value) => {
                    if (value && value.trim()) {
                        try {
                            const folder = FolderManager.createFolder(value.trim());
                            notify('✅ Папка "' + folder.name + '" создана');
                            UI.refreshBookmarks();
                        } catch(e) {
                            notify('❌ ' + e.message);
                        }
                    } else if (value !== null) {
                        notify('❌ Имя не может быть пустым');
                    }
                });
            });
            
            return el;
        },

        // Обновление раздела закладок
        refreshBookmarks() {
            const container = document.querySelector('.bookmarks-container');
            if (!container) {
                // Если контейнера нет, создаем его
                this.renderBookmarksSection();
                return;
            }
            
            // Очищаем и перестраиваем
            container.innerHTML = '';
            const folders = FolderManager.getAllFolders();
            
            if (folders.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty-bookmarks';
                empty.textContent = 'Нет папок. Нажмите "+" для создания.';
                container.appendChild(empty);
            } else {
                folders.forEach(folder => {
                    const el = this.renderFolder(folder);
                    container.appendChild(el);
                });
            }
            
            // Добавляем кнопку создания
            const addBtn = this.renderAddButton();
            container.appendChild(addBtn);
        },

        // Рендер секции закладок на главной
        renderBookmarksSection() {
            // Находим или создаем контейнер
            let container = document.querySelector('.bookmarks-container');
            if (!container) {
                // Ищем место для вставки
                const target = document.querySelector('.content-rows') || 
                              document.querySelector('.main-content') ||
                              document.querySelector('#app .scroll__body');
                
                if (!target) {
                    // Если не нашли, ждем загрузку
                    setTimeout(() => this.renderBookmarksSection(), 1000);
                    return;
                }
                
                container = document.createElement('div');
                container.className = 'bookmarks-container content-rows';
                container.style.cssText = 'padding: 20px;';
                
                // Заголовок
                const header = document.createElement('div');
                header.className = 'bookmarks-header';
                header.innerHTML = `
                    <h2 style="color: var(--text-color, #fff); margin: 0 0 15px 0; font-size: 1.2em;">
                        📁 Мои папки
                    </h2>
                `;
                container.appendChild(header);
                
                const grid = document.createElement('div');
                grid.className = 'bookmarks-grid';
                grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 15px;';
                container.appendChild(grid);
                
                // Вставляем в начало
                target.insertBefore(container, target.firstChild);
            }
            
            this.refreshBookmarks();
        },

        // Модуль для карточки - добавление в папки
        createCardModule() {
            return {
                onCreate: function() {
                    // Добавляем иконку книги на карточку
                    this.on('favorite', function() {
                        this.renderFolderIcon();
                    });
                    
                    // Рендер иконки папки
                    this.renderFolderIcon = function() {
                        const container = this.html.find('.card__icons-inner');
                        if (!container.length) return;
                        
                        // Проверяем наличие в папках
                        const folders = FolderManager.getAllFolders();
                        let inAnyFolder = false;
                        
                        folders.forEach(f => {
                            const items = FolderManager.getFolderItems(f.name);
                            if (items.find(c => c.id === this.data.id)) {
                                inAnyFolder = true;
                            }
                        });
                        
                        // Удаляем старую иконку
                        container.find('.icon--folder').remove();
                        
                        if (inAnyFolder) {
                            const icon = document.createElement('div');
                            icon.className = 'card__icon icon--folder';
                            icon.innerHTML = this.folderIconSVG();
                            container.append(icon);
                        }
                    };
                    
                    this.folderIconSVG = function() {
                        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>`;
                    };
                    
                    // Обработчик клика на иконку для управления папками
                    this.html.on('hover:long', '.card__icon.icon--folder', (e) => {
                        e.stopPropagation();
                        this.showFolderMenu();
                    });
                    
                    this.showFolderMenu = function() {
                        const folders = FolderManager.getAllFolders();
                        const items = folders.map(f => {
                            const inFolder = FolderManager.getFolderItems(f.name).find(c => c.id === this.data.id);
                            return {
                                title: f.name + (inFolder ? ' ✅' : ''),
                                action: 'toggle',
                                folder: f.name
                            };
                        });
                        
                        items.push({ title: '──────────', separator: true });
                        items.push({ title: '➕ Создать папку', action: 'create' });
                        
                        Lampa.Select.show({
                            title: 'Папки избранного',
                            items: items,
                            onSelect: (item) => {
                                if (item.action === 'toggle') {
                                    try {
                                        FolderManager.toggleCard(item.folder, this.data);
                                        notify('✅ Обновлено');
                                        this.renderFolderIcon();
                                    } catch(e) {
                                        notify('❌ ' + e.message);
                                    }
                                } else if (item.action === 'create') {
                                    Lampa.Input.edit({
                                        title: 'Название папки',
                                        value: '',
                                        free: true,
                                        nosave: true
                                    }, (value) => {
                                        if (value && value.trim()) {
                                            try {
                                                FolderManager.createFolder(value.trim());
                                                notify('✅ Папка создана');
                                                UI.refreshBookmarks();
                                            } catch(e) {
                                                notify('❌ ' + e.message);
                                            }
                                        }
                                    });
                                }
                            }
                        });
                    };
                    
                    // Добавляем в контекстное меню
                    if (this.menu_list) {
                        this.menu_list.push({
                            title: 'Папки избранного',
                            menu: () => {
                                const folders = FolderManager.getAllFolders();
                                return folders.map(f => {
                                    const inFolder = FolderManager.getFolderItems(f.name).find(c => c.id === this.data.id);
                                    return {
                                        title: f.name,
                                        checkbox: true,
                                        checked: !!inFolder,
                                        onCheck: () => {
                                            try {
                                                FolderManager.toggleCard(f.name, this.data);
                                                UI.refreshBookmarks();
                                            } catch(e) {
                                                notify('❌ ' + e.message);
                                            }
                                        }
                                    };
                                });
                            }
                        });
                    }
                },
                
                onDestroy: function() {
                    // Очистка
                }
            };
        }
    };

    // ============== КОМПОНЕНТ ДЛЯ ПРОСМОТРА ПАПКИ ==============
    function CustomFavoritesComponent(object) {
        const folderName = object.folder || object.title || 'Избранное';
        const items = FolderManager.getFolderItems(folderName);
        
        const comp = Lampa.Utils.createInstance(Lampa.Category, object, {
            module: Lampa.Maker.module('Category')['toggle'](Lampa.Maker.module('Category')['MASK']['base'], 'Pagination')
        });
        
        comp.use({
            onCreate: function() {
                const data = {
                    results: items.slice(0, 20),
                    total_pages: Math.ceil(items.length / 20),
                    title: folderName
                };
                this.build(data);
            },
            onNext: function(resolve, reject) {
                const page = object.page || 1;
                const start = (page - 1) * 20;
                const end = start + 20;
                const data = {
                    results: items.slice(start, end),
                    total_pages: Math.ceil(items.length / 20)
                };
                resolve(data);
            },
            onInstance: function(item, data) {
                item.use({
                    onEnter: function() {
                        Lampa.Router.call('full', data);
                    },
                    onFocus: function() {
                        if (Lampa.Background) {
                            Lampa.Background.change(data.poster_path || data.backdrop_path || data.img);
                        }
                    }
                });
            }
        });
        
        return comp;
    }

    // ============== НАСТРОЙКИ ==============
    function setupSettings() {
        try {
            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addComponent === 'function') {
                Lampa.SettingsApi.addComponent({
                    component: 'custom_favorites_sync',
                    name: '☁️ Синхронизация избранного',
                    icon: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/></svg>'
                });
            }

            if (Lampa.SettingsApi && typeof Lampa.SettingsApi.addParam === 'function') {
                Lampa.SettingsApi.addParam({
                    component: 'custom_favorites_sync',
                    param: {
                        name: 'sync_settings',
                        type: 'button'
                    },
                    field: {
                        name: 'Настройка Gist',
                        description: 'GitHub Gist для синхронизации'
                    },
                    onChange: function() {
                        showSetupDialog();
                    }
                });
            }
        } catch(e) {
            logError('Settings setup error:', e);
            // Добавляем пункт в меню как fallback
            addMenuItem();
        }
    }

    function addMenuItem() {
        setTimeout(function() {
            const ml = $('.menu__list').eq(0);
            if (!ml.length) return;
            if ($('.custom-fav-sync-menu-item').length) return;
            
            const el = $(
                '<li class="menu__item selector custom-fav-sync-menu-item">' +
                    '<div class="menu__ico">' +
                        '<svg viewBox="0 0 24 24" width="20" height="20">' +
                            '<path fill="currentColor" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M13,7H11V13H17V11H13V7Z"/>' +
                        '</svg>' +
                    '</div>' +
                    '<div class="menu__text">☁️ Синхр. избранного</div>' +
                '</li>'
            );
            
            el.on('hover:enter', function(e) {
                e.stopPropagation();
                showSetupDialog();
            });
            
            ml.append(el);
            log('Menu item added (fallback)');
        }, 2000);
    }

    function showSetupDialog() {
        const cfg = getConfig();
        const folders = FolderManager.getAllFolders();
        const lastSync = cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Никогда';
        const profileId = getProfileId() || 'не задан';
        
        const items = [
            { title: '🔑 Токен: ' + (cfg.token ? '✅ Установлен' : '❌ Не установлен'), action: 'token' },
            { title: '📄 Gist ID: ' + (cfg.gistId ? cfg.gistId.substring(0, 8) + '…' : '❌ Не создан'), action: 'id' },
            { title: '👤 Profile ID: ' + profileId, action: 'status' },
            { title: '──────────', separator: true },
            { title: '📁 Папок: ' + folders.length, action: 'status' },
            { title: '🔄 Последняя синхр.: ' + lastSync, action: 'status' },
            { title: '──────────', separator: true },
            { title: '📤 Выгрузить в Gist', action: 'upload' },
            { title: '📥 Загрузить из Gist', action: 'download' },
            { title: '──────────', separator: true },
            { title: '🔄 Автосинхр.: ' + (cfg.autoSync ? '✅ Вкл' : '❌ Выкл'), action: 'toggle_auto' },
            { title: '──────────', separator: true },
            { title: '📁 Управление папками', action: 'manage_folders' },
            { title: '──────────', separator: true },
            { title: '❌ Закрыть', action: 'cancel' }
        ];

        try {
            Lampa.Select.show({
                title: '☁️ GitHub Gist Синхронизация',
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
                            showSetupDialog();
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
                            showSetupDialog();
                        });
                    } else if (item.action === 'upload') {
                        SyncManager.syncToGist(true);
                        setTimeout(showSetupDialog, 2000);
                    } else if (item.action === 'download') {
                        SyncManager.syncFromGist(true);
                        setTimeout(showSetupDialog, 2000);
                    } else if (item.action === 'toggle_auto') {
                        newCfg.autoSync = !newCfg.autoSync;
                        saveConfig(newCfg);
                        notify('Автосинхронизация ' + (newCfg.autoSync ? 'включена' : 'выключена'));
                        showSetupDialog();
                    } else if (item.action === 'manage_folders') {
                        showFolderManagerDialog();
                    }
                }
            });
        } catch(e) {
            // Fallback
            alert('☁️ GitHub Gist Синхронизация\n\n' +
                  '1. Токен: ' + (cfg.token ? 'Установлен' : 'Не установлен') + '\n' +
                  '2. Gist ID: ' + (cfg.gistId ? cfg.gistId : 'Не создан') + '\n' +
                  '3. Папок: ' + folders.length + '\n' +
                  '4. Автосинхр.: ' + (cfg.autoSync ? 'Вкл' : 'Выкл') + '\n\n' +
                  'Для настройки откройте плагин через настройки Lampa');
        }
    }

    function showFolderManagerDialog() {
        const folders = FolderManager.getAllFolders();
        const items = folders.map(f => ({
            title: f.name + ' (' + f.count + ')',
            action: 'folder',
            folder: f.name
        }));
        
        items.push({ title: '──────────', separator: true });
        items.push({ title: '➕ Создать папку', action: 'create' });
        items.push({ title: '──────────', separator: true });
        items.push({ title: '❌ Закрыть', action: 'cancel' });

        try {
            Lampa.Select.show({
                title: '📁 Управление папками',
                items: items,
                onSelect: function(item) {
                    if (item.action === 'folder') {
                        UI.showFolderMenu(item.folder);
                    } else if (item.action === 'create') {
                        Lampa.Input.edit({
                            title: 'Название папки',
                            value: '',
                            free: true,
                            nosave: true
                        }, function(value) {
                            if (value && value.trim()) {
                                try {
                                    FolderManager.createFolder(value.trim());
                                    notify('✅ Папка создана');
                                    UI.refreshBookmarks();
                                    showFolderManagerDialog();
                                } catch(e) {
                                    notify('❌ ' + e.message);
                                }
                            }
                        });
                    } else if (item.action === 'cancel') {
                        showSetupDialog();
                    }
                }
            });
        } catch(e) {
            const names = folders.map(f => f.name + ' (' + f.count + ')').join('\n');
            const choice = prompt('📁 Управление папками\n\n' + names + '\n\nВведите название папки для просмотра/управления или оставьте пустым для создания:');
            if (choice !== null) {
                if (choice.trim()) {
                    const folder = folders.find(f => f.name.toLowerCase() === choice.trim().toLowerCase());
                    if (folder) {
                        UI.showFolderMenu(folder.name);
                    } else {
                        try {
                            FolderManager.createFolder(choice.trim());
                            notify('✅ Папка создана');
                            UI.refreshBookmarks();
                        } catch(e) {
                            notify('❌ ' + e.message);
                        }
                    }
                }
            }
        }
    }

    // ============== ИНИЦИАЛИЗАЦИЯ ==============
    function init() {
        const cfg = getConfig();
        if (!cfg.enabled) {
            log('Disabled');
            return;
        }

        log('===== INIT CustomFavoritesSync =====');
        log('Profile:', getProfileId() || 'default');
        log('Token:', cfg.token ? '✓' : '✗');
        log('Gist ID:', cfg.gistId ? '✓' : '✗');
        log('Auto sync:', cfg.autoSync ? '✓' : '✗');
        log('Folders:', FolderManager.getAllFolders().length);

        // Регистрируем компонент
        if (Lampa.Component && typeof Lampa.Component.add === 'function') {
            Lampa.Component.add('custom_favorites', CustomFavoritesComponent);
        }

        // Добавляем расширения для карточек
        if (Lampa.Card && Lampa.Card.prototype) {
            const origOnCreate = Lampa.Card.prototype.onCreate;
            Lampa.Card.prototype.onCreate = function() {
                if (origOnCreate) origOnCreate.call(this);
                // Добавляем функциональность папок
                const folderModule = UI.createCardModule();
                if (folderModule.onCreate) folderModule.onCreate.call(this);
            };
        }

        // Добавляем в контентные строки
        try {
            if (Lampa.ContentRows && typeof Lampa.ContentRows.add === 'function') {
                Lampa.ContentRows.add({
                    name: 'custom_favorites',
                    title: '📁 Мои папки',
                    index: 0,
                    screen: ['main'],
                    call: function() {
                        const folders = FolderManager.getAllFolders();
                        if (folders.length === 0) return null;
                        
                        return function(callback) {
                            callback({
                                results: folders.map(f => ({
                                    title: f.name,
                                    count: f.count,
                                    params: {
                                        module: Lampa.Maker.module('Register')['only']('Line', 'Callback'),
                                        createInstance: function(item) {
                                            return new Lampa.Register(item);
                                        },
                                        emit: {
                                            onEnter: function() {
                                                Lampa.Activity.push({
                                                    url: '',
                                                    title: f.name,
                                                    component: 'custom_favorites',
                                                    folder: f.name,
                                                    page: 1
                                                });
                                            }
                                        }
                                    }
                                })),
                                params: {
                                    items: {
                                        view: 4
                                    }
                                }
                            });
                        };
                    }
                });
            }
        } catch(e) {
            logError('ContentRows add error:', e);
        }

        // Добавляем CSS
        addStyles();

        // Настройки
        setupSettings();

        // Слушатели
        Lampa.Listener.follow('state:changed', function(e) {
            if (e.target === 'favorite' || e.target === 'custom_favorites') {
                if (e.reason === 'update' || e.reason === 'sync_complete') {
                    UI.refreshBookmarks();
                }
            }
        });

        // Загружаем данные из Gist при старте
        if (cfg.token && cfg.gistId) {
            setTimeout(function() {
                SyncManager.syncFromGist(false);
            }, 3000);
        }

        // Периодическая синхронизация
        SyncManager.startPeriodicSync();

        // Рендерим секцию закладок
        setTimeout(function() {
            UI.renderBookmarksSection();
        }, 2000);

        log('Ready');
    }

    function addStyles() {
        try {
            const style = document.createElement('style');
            style.id = 'custom-favorites-sync-styles';
            style.textContent = `
                .bookmarks-container {
                    padding: 15px 20px;
                }
                .bookmarks-header h2 {
                    color: var(--text-color, #fff);
                    margin: 0 0 15px 0;
                    font-size: 1.2em;
                }
                .bookmarks-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 15px;
                }
                .bookmarks-folder {
                    cursor: pointer;
                    transition: transform 0.2s;
                    background: rgba(255,255,255,0.05);
                    border-radius: 12px;
                    overflow: hidden;
                    min-height: 160px;
                    position: relative;
                }
                .bookmarks-folder:hover {
                    transform: scale(1.02);
                    background: rgba(255,255,255,0.1);
                }
                .bookmarks-folder__inner {
                    padding: 15px;
                    height: 100%;
                }
                .bookmarks-folder__layer {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                }
                .bookmarks-folder__head {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .bookmarks-folder__title {
                    font-size: 1em;
                    font-weight: 500;
                    color: var(--text-color, #fff);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    flex: 1;
                }
                .bookmarks-folder__num {
                    color: rgba(255,255,255,0.5);
                    font-size: 0.8em;
                    margin-left: 10px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .bookmarks-folder__num img {
                    width: 24px;
                    height: 24px;
                    filter: invert(1);
                }
                .bookmarks-folder__body {
                    display: flex;
                    gap: 8px;
                    flex: 1;
                    align-items: center;
                    justify-content: center;
                    min-height: 80px;
                }
                .bookmarks-folder__body .card__img {
                    width: 60px;
                    height: 85px;
                    object-fit: cover;
                    border-radius: 6px;
                    background: rgba(255,255,255,0.05);
                    opacity: 0.7;
                    transition: opacity 0.3s;
                }
                .bookmarks-folder__body .card__img.card--loaded {
                    opacity: 1;
                }
                .bookmarks-folder__body .empty-folder-preview {
                    color: rgba(255,255,255,0.3);
                    font-size: 0.8em;
                }
                .bookmarks-folder.new-custom-type .bookmarks-folder__body {
                    min-height: 40px;
                }
                .card__icon.icon--folder {
                    position: relative;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                }
                .card__icon.icon--folder svg {
                    width: 18px;
                    height: 18px;
                }
                .bookmarks-folder__num .icon--folder svg {
                    width: 20px;
                    height: 20px;
                }
                .empty-bookmarks {
                    color: rgba(255,255,255,0.3);
                    text-align: center;
                    padding: 30px;
                    font-size: 0.9em;
                }
                @media (max-width: 600px) {
                    .bookmarks-grid {
                        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    }
                    .bookmarks-folder {
                        min-height: 120px;
                    }
                    .bookmarks-folder__body .card__img {
                        width: 45px;
                        height: 65px;
                    }
                }
            `;
            document.head.appendChild(style);
        } catch(e) {
            logError('Styles add error:', e);
        }
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
