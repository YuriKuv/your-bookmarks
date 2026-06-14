/**
 * Плагин "Избранное+" (Favorites Plus)
 * Версия: 1.0.0
 * Описание: Расширенная система избранного с умными списками, продвинутыми таймкодами,
 *          автоматическими статусами, синхронизацией через Gist и отслеживанием новых серий
 * Автор: На основе ТЗ
 */

(function() {
    // ==================== КОНФИГУРАЦИЯ ПО УМОЛЧАНИЮ ====================
    const DEFAULT_SETTINGS = {
        // Автоматика
        auto_watching_enabled: true,
        auto_completed_enabled: true,
        auto_abandoned_enabled: true,
        watching_percent: 5,      // % для авто-Смотрю
        completed_percent: 95,     // % для авто-Просмотрено
        abandoned_days: 30,        // дней бездействия для авто-Брошено
        
        // Отображение
        poster_status_mode: 'favorites_plus', // 'favorites_plus', 'lampa', 'off'
        poster_status_position: 'bottom',     // 'top', 'center', 'bottom'
        hide_native_favorite_button: false,
        
        // Очистка
        auto_clean_completed_days: 90,
        auto_clean_timecodes_days: 180,
        
        // Синхронизация Gist
        sync_enabled: false,
        sync_gist_id: '',
        sync_token: '',
        sync_interval_hours: 1,
        sync_strategy: 'duration', // 'duration' или 'date'
        
        // Отслеживание новых серий
        track_new_episodes: true,
        track_interval_hours: 6,
        track_notify: true,
        
        // Логи
        log_enabled: true,
        max_log_entries: 100
    };
    
    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
    const Utils = {
        // Генерация уникального ключа для таймкода
        generateTimecodeKey(item, season, episode) {
            if (item.type === 'tv' || item.name === 'tv' || (item.seasons && item.seasons.length)) {
                const tmdbId = item.id || item.tmdb_id;
                const seasonNum = season || item.season || 1;
                const episodeNum = episode || item.episode || 1;
                return `${tmdbId}_s${seasonNum}_e${episodeNum}`;
            }
            return String(item.id || item.tmdb_id);
        },
        
        // Очистка HTML тегов
        cleanHtml(str) {
            if (!str) return '';
            return String(str).replace(/<[^>]*>/g, '').trim();
        },
        
        // Форматирование времени
        formatTime(seconds) {
            if (!seconds || seconds < 0) return '0:00';
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            if (hours > 0) {
                return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            }
            return `${minutes}:${secs.toString().padStart(2, '0')}`;
        },
        
        // Получение оставшегося времени
        getRemainingTime(current, duration) {
            if (!duration) return '';
            const remaining = duration - current;
            return this.formatTime(remaining);
        },
        
        // Глубокое клонирование
        clone(obj) {
            return JSON.parse(JSON.stringify(obj));
        },
        
        // Проверка на сериал
        isSeries(item) {
            return item && (item.type === 'tv' || item.name === 'tv' || 
                   (item.number_of_seasons) || (item.seasons && item.seasons.length));
        },
        
        // Получение TMDB ID
        getTmdbId(item) {
            return item.id || item.tmdb_id || item.movie?.id;
        }
    };
    
    // ==================== МОДУЛЬ ХРАНЕНИЯ (Smart Lists) ====================
    const SmartLists = {
        // Список категорий с их приоритетом (выше число = выше приоритет)
        categories: {
            watching:    { name: 'Смотрю', icon: '👁️', priority: 5, storageKey: 'favplus_watching' },
            favorite:    { name: 'Избранное', icon: '⭐', priority: 4, storageKey: 'favplus_favorite' },
            planned:     { name: 'Буду смотреть', icon: '📋', priority: 3, storageKey: 'favplus_planned' },
            abandoned:   { name: 'Брошено', icon: '❌', priority: 2, storageKey: 'favplus_abandoned' },
            collection:  { name: 'Коллекция', icon: '📦', priority: 1, storageKey: 'favplus_collection' },
            completed:   { name: 'Просмотрено', icon: '✅', priority: 0, storageKey: 'favplus_completed' }
        },
        
        // Инициализация хранилищ
        init() {
            for (const [key, cat] of Object.entries(this.categories)) {
                if (Lampa.Storage.get(cat.storageKey) === undefined) {
                    Lampa.Storage.set(cat.storageKey, []);
                }
            }
            if (Lampa.Storage.get('favplus_movements_log') === undefined) {
                Lampa.Storage.set('favplus_movements_log', []);
            }
        },
        
        // Добавить в лог перемещений
        addLog(item, fromCategory, toCategory) {
            if (!Settings.get('log_enabled')) return;
            
            const log = Lampa.Storage.get('favplus_movements_log', []);
            log.unshift({
                timestamp: Date.now(),
                itemTitle: item.title || item.name,
                itemId: Utils.getTmdbId(item),
                from: fromCategory,
                to: toCategory,
                date: new Date().toLocaleString()
            });
            
            // Ограничиваем размер лога
            while (log.length > Settings.get('max_log_entries', 100)) {
                log.pop();
            }
            
            Lampa.Storage.set('favplus_movements_log', log);
        },
        
        // Получить все списки
        getAllLists() {
            const lists = {};
            for (const [key, cat] of Object.entries(this.categories)) {
                lists[key] = Lampa.Storage.get(cat.storageKey, []);
            }
            return lists;
        },
        
        // Получить элемент из всех списков
        findItem(itemId) {
            const lists = this.getAllLists();
            for (const [listName, items] of Object.entries(lists)) {
                const found = items.find(i => String(Utils.getTmdbId(i)) === String(itemId));
                if (found) return { list: listName, item: found };
            }
            return null;
        },
        
        // Добавить в список
        addToList(listKey, item, skipLog = false) {
            const cat = this.categories[listKey];
            if (!cat) return false;
            
            const items = Lampa.Storage.get(cat.storageKey, []);
            const existingIndex = items.findIndex(i => Utils.getTmdbId(i) === Utils.getTmdbId(item));
            
            if (existingIndex === -1) {
                // Добавляем с метаданными
                const itemToAdd = Utils.clone(item);
                itemToAdd._favplus_added = Date.now();
                itemToAdd._favplus_list = listKey;
                items.push(itemToAdd);
                Lampa.Storage.set(cat.storageKey, items);
                
                if (!skipLog) this.addLog(item, null, listKey);
                return true;
            }
            return false;
        },
        
        // Удалить из списка
        removeFromList(listKey, itemId, skipLog = false) {
            const cat = this.categories[listKey];
            if (!cat) return false;
            
            let items = Lampa.Storage.get(cat.storageKey, []);
            const removedItem = items.find(i => Utils.getTmdbId(i) === itemId);
            items = items.filter(i => Utils.getTmdbId(i) !== itemId);
            Lampa.Storage.set(cat.storageKey, items);
            
            if (!skipLog && removedItem) {
                this.addLog(removedItem, listKey, null);
            }
            return true;
        },
        
        // Переместить между списками
        moveBetweenLists(fromList, toList, item) {
            const itemId = Utils.getTmdbId(item);
            if (fromList) this.removeFromList(fromList, itemId, true);
            this.addToList(toList, item, true);
            this.addLog(item, fromList, toList);
            return true;
        },
        
        // Получить главный статус элемента (с учетом иерархии)
        getPrimaryStatus(itemId) {
            const lists = this.getAllLists();
            let bestList = null;
            let bestPriority = -1;
            
            for (const [listName, items] of Object.entries(lists)) {
                if (items.find(i => String(Utils.getTmdbId(i)) === String(itemId))) {
                    const priority = this.categories[listName]?.priority || 0;
                    if (priority > bestPriority) {
                        bestPriority = priority;
                        bestList = listName;
                    }
                }
            }
            
            return bestList ? this.categories[bestList] : null;
        },
        
        // Очистить все списки от элемента
        removeFromAllLists(itemId) {
            for (const [key, cat] of Object.entries(this.categories)) {
                this.removeFromList(key, itemId, true);
            }
        }
    };
    
    // ==================== МОДУЛЬ ТАЙМКОДОВ ====================
    const TimecodeManager = {
        // Маппинг ключей Lampa -> Favorites Plus
        keyMapping: {},
        
        init() {
            if (Lampa.Storage.get('favplus_key_mapping') === undefined) {
                Lampa.Storage.set('favplus_key_mapping', {});
            }
            this.keyMapping = Lampa.Storage.get('favplus_key_mapping', {});
        },
        
        // Получить ключ Lampa (штатный)
        getLampaKey(item, season, episode) {
            if (Utils.isSeries(item)) {
                return `${item.id}_s${season || item.season || 1}_e${episode || item.episode || 1}`;
            }
            return String(item.id);
        },
        
        // Получить ключ плагина
        getPluginKey(item, season, episode) {
            return Utils.generateTimecodeKey(item, season, episode);
        },
        
        // Сохранить маппинг
        saveMapping(lampaKey, pluginKey) {
            this.keyMapping[lampaKey] = pluginKey;
            Lampa.Storage.set('favplus_key_mapping', this.keyMapping);
        },
        
        // Получить прогресс из таймкода
        getProgress(item, season, episode) {
            const pluginKey = this.getPluginKey(item, season, episode);
            const timecode = Lampa.Storage.get(`favplus_timecode_${pluginKey}`, null);
            
            if (timecode) return timecode;
            
            // Пробуем прочитать из штатного file_view
            const lampaKey = this.getLampaKey(item, season, episode);
            const lampaTimecode = Lampa.Timeline.view(lampaKey);
            
            if (lampaTimecode && lampaTimecode.time) {
                this.saveTimecode(item, lampaKey, lampaTimecode.time, lampaTimecode.duration, season, episode);
                return lampaTimecode;
            }
            
            return null;
        },
        
        // Сохранить таймкод (двойное сохранение)
        saveTimecode(item, lampaKey, currentTime, duration, season, episode) {
            const pluginKey = this.getPluginKey(item, season, episode);
            const percent = duration > 0 ? (currentTime / duration * 100) : 0;
            
            const timecodeData = {
                time: currentTime,
                duration: duration,
                percent: percent,
                updated: Date.now(),
                lampaKey: lampaKey
            };
            
            // Сохраняем в хранилище плагина
            Lampa.Storage.set(`favplus_timecode_${pluginKey}`, timecodeData);
            
            // Сохраняем маппинг
            this.saveMapping(lampaKey, pluginKey);
            
            // Сохраняем в штатное хранилище Lampa (file_view)
            if (Lampa.Timeline && Lampa.Timeline.save) {
                Lampa.Timeline.save(lampaKey, currentTime, duration);
            } else if (Lampa.Storage.field && Lampa.Storage.field('file_view', lampaKey)) {
                // Альтернативный способ
                const fileView = Lampa.Storage.field('file_view', {}) || {};
                fileView[lampaKey] = { time: currentTime, duration: duration, date: Date.now() };
                Lampa.Storage.set('file_view', fileView);
            }
            
            return timecodeData;
        },
        
        // Удалить таймкод
        deleteTimecode(item, season, episode) {
            const pluginKey = this.getPluginKey(item, season, episode);
            Lampa.Storage.set(`favplus_timecode_${pluginKey}`, null);
            
            const lampaKey = this.getLampaKey(item, season, episode);
            if (Lampa.Timeline && Lampa.Timeline.remove) {
                Lampa.Timeline.remove(lampaKey);
            }
        },
        
        // Очистить все старые таймкоды
        cleanOldTimecodes(days) {
            const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
            const allKeys = Object.keys(localStorage);
            
            allKeys.forEach(key => {
                if (key.startsWith('favplus_timecode_')) {
                    const timecode = Lampa.Storage.get(key, null);
                    if (timecode && timecode.updated && timecode.updated < threshold) {
                        Lampa.Storage.set(key, null);
                    }
                }
            });
        }
    };
    
    // ==================== МОДУЛЬ АВТОМАТИЧЕСКИХ СТАТУСОВ ====================
    const AutoStatus = {
        // Проверка и обновление статуса на основе прогресса
        checkAndUpdate(item, currentTime, duration, season, episode) {
            if (!item) return;
            
            const percent = duration > 0 ? (currentTime / duration * 100) : 0;
            const isSeries = Utils.isSeries(item);
            const itemId = Utils.getTmdbId(item);
            const currentStatus = SmartLists.getPrimaryStatus(itemId);
            
            // Авто-Смотрю (при достижении watching_percent%)
            if (Settings.get('auto_watching_enabled') && percent >= Settings.get('watching_percent')) {
                if (!currentStatus || currentStatus.name !== 'Смотрю') {
                    // Не применяем если уже Просмотрено
                    const isCompleted = SmartLists.categories.completed.storageKey === currentStatus?.storageKey;
                    if (!isCompleted) {
                        SmartLists.moveBetweenLists(currentStatus?.name?.toLowerCase(), 'watching', item);
                        this._notifyStatusChange(item, 'Смотрю');
                    }
                }
            }
            
            // Авто-Просмотрено (при достижении completed_percent%)
            if (Settings.get('auto_completed_enabled') && percent >= Settings.get('completed_percent')) {
                if (!currentStatus || currentStatus.name !== 'Просмотрено') {
                    // Для сериалов проверяем, что это последняя серия последнего сезона
                    if (isSeries) {
                        this._isLastEpisode(item, season, episode, (isLast) => {
                            if (isLast) {
                                this._markAsCompleted(item, currentStatus);
                            }
                        });
                    } else {
                        this._markAsCompleted(item, currentStatus);
                    }
                }
            }
        },
        
        // Отметить как просмотрено
        _markAsCompleted(item, currentStatus) {
            const itemId = Utils.getTmdbId(item);
            
            // Удаляем из других списков (кроме коллекции)
            if (currentStatus && currentStatus.name !== 'Коллекция') {
                SmartLists.removeFromList(currentStatus.name.toLowerCase(), itemId, true);
            }
            
            SmartLists.addToList('completed', item, true);
            this._notifyStatusChange(item, 'Просмотрено');
        },
        
        // Проверка последней серии (асинхронно через TMDB)
        _isLastEpisode(item, currentSeason, currentEpisode, callback) {
            // Получаем данные о сериале из TMDB
            const tmdbId = Utils.getTmdbId(item);
            if (!tmdbId || !Lampa.TMDB) {
                callback(true); // Если не можем проверить, считаем что последняя
                return;
            }
            
            Lampa.TMDB.api.tv({ id: tmdbId }, (data) => {
                if (data && data.seasons) {
                    const lastSeason = data.seasons[data.seasons.length - 1];
                    const lastSeasonNumber = lastSeason.season_number;
                    const lastEpisodeCount = lastSeason.episode_count || 0;
                    
                    const isLastSeason = currentSeason >= lastSeasonNumber;
                    const isLastEpisode = currentEpisode >= lastEpisodeCount;
                    
                    callback(isLastSeason && isLastEpisode);
                } else {
                    callback(true);
                }
            }, () => {
                callback(true);
            });
        },
        
        // Проверка брошенных (не обновлялись более N дней)
        checkAbandoned() {
            if (!Settings.get('auto_abandoned_enabled')) return;
            
            const watchingList = Lampa.Storage.get(SmartLists.categories.watching.storageKey, []);
            const threshold = Date.now() - (Settings.get('abandoned_days') * 24 * 60 * 60 * 1000);
            
            watchingList.forEach(item => {
                const itemId = Utils.getTmdbId(item);
                // Проверяем последний таймкод
                const timecode = TimecodeManager.getProgress(item);
                if (timecode && timecode.updated && timecode.updated < threshold) {
                    SmartLists.moveBetweenLists('watching', 'abandoned', item);
                    this._notifyStatusChange(item, 'Брошено');
                }
            });
        },
        
        // Очистка старых просмотренных
        cleanOldCompleted() {
            const days = Settings.get('auto_clean_completed_days');
            if (days <= 0) return;
            
            const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
            const completedList = Lampa.Storage.get(SmartLists.categories.completed.storageKey, []);
            const toRemove = completedList.filter(item => {
                const added = item._favplus_added || 0;
                return added < threshold;
            });
            
            toRemove.forEach(item => {
                SmartLists.removeFromList('completed', Utils.getTmdbId(item), true);
            });
        },
        
        // Уведомление об изменении статуса
        _notifyStatusChange(item, newStatus) {
            if (Lampa.Noty) {
                Lampa.Noty.show(`${Utils.cleanHtml(item.title || item.name)} → ${newStatus}`, 3000);
            }
        }
    };
    
    // ==================== МОДУЛЬ UI (ВИЗУАЛЬНОЕ ОТОБРАЖЕНИЕ) ====================
    const UIInjector = {
        init() {
            this.patchPosterRender();
            this.patchFullCardRender();
            this.addCustomMenuButton();
        },
        
        // Патчинг рендера постера для отображения статуса
        patchPosterRender() {
            if (!Lampa.Card || !Lampa.Card.render) return;
            
            const originalRender = Lampa.Card.render;
            Lampa.Card.render = function(item, category, params) {
                const $card = originalRender.call(this, item, category, params);
                
                if (Settings.get('poster_status_mode') === 'favorites_plus') {
                    const itemId = Utils.getTmdbId(item);
                    const status = SmartLists.getPrimaryStatus(itemId);
                    const timecode = TimecodeManager.getProgress(item);
                    
                    if (status || timecode) {
                        let statusHtml = '';
                        const position = Settings.get('poster_status_position', 'bottom');
                        const positionClass = `poster-status--${position}`;
                        
                        if (status) {
                            statusHtml += `<div class="poster-status ${positionClass} poster-status--${status.name}">
                                            <span class="poster-status__icon">${status.icon}</span>
                                            <span class="poster-status__text">${status.name}</span>
                                          </div>`;
                        }
                        
                        if (timecode && timecode.percent > 0 && timecode.percent < 95) {
                            const remaining = Utils.getRemainingTime(timecode.time, timecode.duration);
                            statusHtml += `<div class="poster-progress ${positionClass}">
                                            <div class="poster-progress__bar" style="width: ${timecode.percent}%"></div>
                                            <span class="poster-progress__text">${remaining}</span>
                                          </div>`;
                        }
                        
                        $card.find('.card__view').append(statusHtml);
                    }
                }
                
                return $card;
            };
        },
        
        // Патчинг полной карточки
        patchFullCardRender() {
            if (!Lampa.FullCard || !Lampa.FullCard.render) return;
            
            const originalRender = Lampa.FullCard.render;
            Lampa.FullCard.render = function(item) {
                const $full = originalRender.call(this, item);
                
                const itemId = Utils.getTmdbId(item);
                const status = SmartLists.getPrimaryStatus(itemId);
                
                if (status) {
                    const $statusBlock = $(`<div class="favplus-status-block">
                        <div class="favplus-status-icon">${status.icon}</div>
                        <div class="favplus-status-text">Статус: ${status.name}</div>
                    </div>`);
                    
                    $full.find('.full-info__about').prepend($statusBlock);
                }
                
                // Замена/добавление кнопки избранного
                if (Settings.get('hide_native_favorite_button')) {
                    $full.find('.full-info__favorite, .button--favorite').hide();
                }
                
                this.addCustomFavoriteButton($full, item);
                
                return $full;
            }.bind(this);
        },
        
        // Добавление кастомной кнопки избранного
        addCustomFavoriteButton($full, item) {
            const $customBtn = $(`<div class="button favplus-favorite-btn selector">
                <div class="button__icon">⭐</div>
                <div class="button__text">В избранное</div>
            </div>`);
            
            $customBtn.on('hover:enter', () => {
                this.showCategoryMenu(item);
            });
            
            $full.find('.full-info__buttons, .info-card__buttons').append($customBtn);
        },
        
        // Меню выбора категории
        showCategoryMenu(item) {
            const currentStatus = SmartLists.getPrimaryStatus(Utils.getTmdbId(item));
            const items = [];
            
            for (const [key, cat] of Object.entries(SmartLists.categories)) {
                items.push({
                    title: `${cat.icon} ${cat.name}`,
                    selected: currentStatus?.storageKey === cat.storageKey,
                    listKey: key
                });
            }
            
            if (Lampa.Select) {
                Lampa.Select.show({
                    title: 'Добавить в список',
                    items: items,
                    onSelect: (selected) => {
                        if (selected.listKey) {
                            if (currentStatus && currentStatus.storageKey !== SmartLists.categories[selected.listKey].storageKey) {
                                SmartLists.moveBetweenLists(currentStatus?.name?.toLowerCase(), selected.listKey, item);
                            } else if (!currentStatus) {
                                SmartLists.addToList(selected.listKey, item);
                            }
                        }
                    }
                });
            }
        },
        
        // Добавление пункта в боковое меню
        addCustomMenuButton() {
            const menuButton = $(`<li class="menu__item selector">
                <div class="menu__ico">⭐</div>
                <div class="menu__text">Избранное+</div>
            </li>`);
            
            menuButton.on('hover:enter', () => {
                this.showFavoritesPlusMenu();
            });
            
            const checkInterval = setInterval(() => {
                if ($('.menu__list').length) {
                    $('.menu__list').eq(0).append(menuButton);
                    clearInterval(checkInterval);
                }
            }, 500);
        },
        
        // Главное меню Избранное+
        showFavoritesPlusMenu() {
            const items = [
                { title: '📋 Мои списки', action: 'showLists' },
                { title: '▶️ Продолжить просмотр', action: 'continueWatching' },
                { title: '🎲 Случайный фильм', action: 'randomMovie' },
                { title: '🔍 Поиск по избранному', action: 'searchFavorites' },
                { title: '📊 Статистика', action: 'showStats' },
                { title: '📜 История просмотров', action: 'showHistory' },
                { title: '⚙️ Настройки', action: 'settings' }
            ];
            
            if (Lampa.Select) {
                Lampa.Select.show({
                    title: 'Избранное+',
                    items: items,
                    onSelect: (selected) => {
                        this[selected.action]();
                    }
                });
            }
        },
        
        // Показать списки
        showLists() {
            const listItems = [];
            for (const [key, cat] of Object.entries(SmartLists.categories)) {
                const count = Lampa.Storage.get(cat.storageKey, []).length;
                listItems.push({
                    title: `${cat.icon} ${cat.name} (${count})`,
                    listKey: key
                });
            }
            
            Lampa.Select.show({
                title: 'Мои списки',
                items: listItems,
                onSelect: (selected) => {
                    this.renderList(selected.listKey);
                }
            });
        },
        
        // Рендер списка
        renderList(listKey) {
            const cat = SmartLists.categories[listKey];
            const items = Lampa.Storage.get(cat.storageKey, []);
            
            // Используем стандартный компонент Lampa для отображения
            if (Lampa.Activity) {
                Lampa.Activity.push({
                    component: 'catalog',
                    title: cat.name,
                    url: '',
                    source: 'favorites_plus',
                    listKey: listKey,
                    items: items
                });
            }
        },
        
        // Продолжить просмотр
        continueWatching() {
            const watchingList = Lampa.Storage.get(SmartLists.categories.watching.storageKey, []);
            let bestItem = null;
            let bestProgress = 0;
            
            watchingList.forEach(item => {
                const progress = TimecodeManager.getProgress(item);
                if (progress && progress.percent > 0 && progress.percent < 95) {
                    if (progress.percent > bestProgress) {
                        bestProgress = progress.percent;
                        bestItem = item;
                    }
                }
            });
            
            if (bestItem && Lampa.Player) {
                // Запуск плеера с последним таймкодом
                Lampa.Player.play({
                    url: bestItem.url || '',
                    title: bestItem.title,
                    card: bestItem,
                    timeline: TimecodeManager.getProgress(bestItem)
                });
            } else {
                Lampa.Noty.show('Нет незавершенных просмотров');
            }
        },
        
        // Случайный фильм из планов или избранного
        randomMovie() {
            const planned = Lampa.Storage.get(SmartLists.categories.planned.storageKey, []);
            const favorite = Lampa.Storage.get(SmartLists.categories.favorite.storageKey, []);
            const all = [...planned, ...favorite];
            
            if (all.length) {
                const random = all[Math.floor(Math.random() * all.length)];
                if (Lampa.Activity) {
                    Lampa.Activity.push({
                        component: 'full',
                        title: random.title,
                        movie: random,
                        id: Utils.getTmdbId(random)
                    });
                }
            } else {
                Lampa.Noty.show('Нет фильмов в планах или избранном');
            }
        },
        
        // Поиск по избранному
        searchFavorites() {
            Lampa.Input.show({
                title: 'Поиск по избранному',
                onEnter: (query) => {
                    const allItems = [];
                    for (const [key, cat] of Object.entries(SmartLists.categories)) {
                        const items = Lampa.Storage.get(cat.storageKey, []);
                        allItems.push(...items.filter(i => 
                            (i.title || i.name || '').toLowerCase().includes(query.toLowerCase())
                        ));
                    }
                    this.renderList('search', allItems);
                }
            });
        },
        
        // Статистика
        showStats() {
            const stats = {
                totalMovies: 0,
                totalSeries: 0,
                totalTimeWatched: 0,
                byCategory: {}
            };
            
            for (const [key, cat] of Object.entries(SmartLists.categories)) {
                const items = Lampa.Storage.get(cat.storageKey, []);
                stats.byCategory[key] = items.length;
                
                items.forEach(item => {
                    if (Utils.isSeries(item)) stats.totalSeries++;
                    else stats.totalMovies++;
                    
                    const progress = TimecodeManager.getProgress(item);
                    if (progress && progress.time) {
                        stats.totalTimeWatched += progress.time;
                    }
                });
            }
            
            const statsText = `
                📊 Статистика Избранное+
                ─────────────────
                🎬 Фильмов: ${stats.totalMovies}
                📺 Сериалов: ${stats.totalSeries}
                ⏱️ Просмотрено: ${Utils.formatTime(stats.totalTimeWatched)}
                ─────────────────
                ⭐ Избранное: ${stats.byCategory.favorite || 0}
                👁️ Смотрю: ${stats.byCategory.watching || 0}
                📋 Планы: ${stats.byCategory.planned || 0}
                ✅ Просмотрено: ${stats.byCategory.completed || 0}
                ❌ Брошено: ${stats.byCategory.abandoned || 0}
                📦 Коллекция: ${stats.byCategory.collection || 0}
            `;
            
            Lampa.Noty.show(statsText, 8000);
        },
        
        // История просмотров
        showHistory() {
            const log = Lampa.Storage.get('favplus_movements_log', []);
            if (!log.length) {
                Lampa.Noty.show('История пуста');
                return;
            }
            
            const historyItems = log.slice(0, 20).map(entry => ({
                title: `${entry.itemTitle}\n${entry.from ? `Из: ${entry.from}` : 'Добавлено'} → ${entry.to || 'удалено'}\n${entry.date}`
            }));
            
            if (Lampa.Select) {
                Lampa.Select.show({
                    title: 'История перемещений',
                    items: historyItems,
                    virtualScroll: true
                });
            }
        },
        
        // Настройки
        settings() {
            if (Lampa.Activity) {
                Lampa.Activity.push({
                    component: 'favorites_plus_settings',
                    title: 'Настройки Избранное+'
                });
            } else {
                Settings.showSettingsDialog();
            }
        }
    };
    
    // ==================== МОДУЛЬ НАСТРОЕК ====================
    const Settings = {
        _settings: Utils.clone(DEFAULT_SETTINGS),
        
        init() {
            this.load();
        },
        
        load() {
            const saved = Lampa.Storage.get('favplus_settings', {});
            this._settings = { ...DEFAULT_SETTINGS, ...saved };
        },
        
        save() {
            Lampa.Storage.set('favplus_settings', this._settings);
        },
        
        get(key, defaultValue = null) {
            return this._settings[key] !== undefined ? this._settings[key] : defaultValue;
        },
        
        set(key, value) {
            this._settings[key] = value;
            this.save();
            Lampa.Listener.send('favplus:settingsChanged', { key, value });
        },
        
        getAll() {
            return Utils.clone(this._settings);
        }
    };
    
    // ==================== МОДУЛЬ СИНХРОНИЗАЦИИ GITHUB GIST ====================
    const GistSync = {
        syncTimer: null,
        
        init() {
            if (Settings.get('sync_enabled')) {
                this.startAutoSync();
            }
            
            Lampa.Listener.follow('favplus:settingsChanged', (e) => {
                if (e.key === 'sync_enabled' && e.value) {
                    this.startAutoSync();
                } else if (e.key === 'sync_enabled' && !e.value) {
                    this.stopAutoSync();
                }
            });
        },
        
        startAutoSync() {
            if (this.syncTimer) clearInterval(this.syncTimer);
            
            const intervalHours = Settings.get('sync_interval_hours', 1);
            this.syncTimer = setInterval(() => this.sync(), intervalHours * 60 * 60 * 1000);
            
            // Первая синхронизация через 5 секунд
            setTimeout(() => this.sync(), 5000);
        },
        
        stopAutoSync() {
            if (this.syncTimer) {
                clearInterval(this.syncTimer);
                this.syncTimer = null;
            }
        },
        
        async sync() {
            if (!Settings.get('sync_enabled')) return;
            
            const gistId = Settings.get('sync_gist_id');
            const token = Settings.get('sync_token');
            
            if (!gistId || !token) {
                console.log('FavPlus: Gist sync not configured');
                return;
            }
            
            await this.upload();
            await this.download();
        },
        
        async upload() {
            const data = {
                'favorites.json': JSON.stringify(SmartLists.getAllLists()),
                'timecodes.json': JSON.stringify(this._getAllTimecodes()),
                'bookmarks.json': JSON.stringify(this._getBookmarks()),
                'history.json': JSON.stringify(Lampa.Storage.get('favplus_movements_log', []))
            };
            
            const gistId = Settings.get('sync_gist_id');
            const token = Settings.get('sync_token');
            
            try {
                const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ files: data })
                });
                
                if (response.ok) {
                    console.log('FavPlus: Sync upload successful');
                }
            } catch (error) {
                console.error('FavPlus: Sync upload failed', error);
            }
        },
        
        async download() {
            const gistId = Settings.get('sync_gist_id');
            const token = Settings.get('sync_token');
            
            try {
                const response = await fetch(`https://api.github.com/gists/${gistId}`, {
                    headers: { 'Authorization': `token ${token}` }
                });
                
                if (response.ok) {
                    const gist = await response.json();
                    const strategy = Settings.get('sync_strategy', 'duration');
                    
                    if (gist.files['favorites.json']) {
                        const remoteFavorites = JSON.parse(gist.files['favorites.json'].content);
                        this._mergeFavorites(remoteFavorites, strategy);
                    }
                    
                    if (gist.files['timecodes.json']) {
                        const remoteTimecodes = JSON.parse(gist.files['timecodes.json'].content);
                        this._mergeTimecodes(remoteTimecodes, strategy);
                    }
                }
            } catch (error) {
                console.error('FavPlus: Sync download failed', error);
            }
        },
        
        _getAllTimecodes() {
            const timecodes = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('favplus_timecode_')) {
                    timecodes[key] = Lampa.Storage.get(key);
                }
            }
            return timecodes;
        },
        
        _mergeFavorites(remote, strategy) {
            const local = SmartLists.getAllLists();
            
            for (const [listName, remoteItems] of Object.entries(remote)) {
                const localItems = local[listName] || [];
                const merged = [...localItems];
                
                remoteItems.forEach(remoteItem => {
                    const exists = localItems.some(localItem => 
                        Utils.getTmdbId(localItem) === Utils.getTmdbId(remoteItem)
                    );
                    
                    if (!exists) {
                        merged.push(remoteItem);
                    }
                });
                
                Lampa.Storage.set(SmartLists.categories[listName]?.storageKey, merged);
            }
        },
        
        _mergeTimecodes(remote, strategy) {
            for (const [key, remoteTc] of Object.entries(remote)) {
                const localTc = Lampa.Storage.get(key);
                
                if (strategy === 'duration' && remoteTc && localTc) {
                    if (remoteTc.time > localTc.time) {
                        Lampa.Storage.set(key, remoteTc);
                    }
                } else if (strategy === 'date' && remoteTc && localTc) {
                    if (remoteTc.updated > localTc.updated) {
                        Lampa.Storage.set(key, remoteTc);
                    }
                } else if (remoteTc && !localTc) {
                    Lampa.Storage.set(key, remoteTc);
                }
            }
        },
        
        _getBookmarks() {
            return Lampa.Storage.get('bookmarks', []);
        }
    };
    
    // ==================== МОДУЛЬ ОТСЛЕЖИВАНИЯ НОВЫХ СЕРИЙ ====================
    const NewEpisodesTracker = {
        trackerTimer: null,
        lastChecked: {},
        newEpisodesCache: [],
        
        init() {
            if (Settings.get('track_new_episodes')) {
                this.startTracking();
            }
            
            Lampa.Listener.follow('favplus:settingsChanged', (e) => {
                if (e.key === 'track_new_episodes' && e.value) {
                    this.startTracking();
                } else if (e.key === 'track_new_episodes' && !e.value) {
                    this.stopTracking();
                }
            });
        },
        
        startTracking() {
            if (this.trackerTimer) clearInterval(this.trackerTimer);
            
            const intervalHours = Settings.get('track_interval_hours', 6);
            this.trackerTimer = setInterval(() => this.check(), intervalHours * 60 * 60 * 1000);
            
            setTimeout(() => this.check(), 10000);
        },
        
        stopTracking() {
            if (this.trackerTimer) {
                clearInterval(this.trackerTimer);
                this.trackerTimer = null;
            }
        },
        
        async check() {
            const watching = Lampa.Storage.get(SmartLists.categories.watching.storageKey, []);
            const planned = Lampa.Storage.get(SmartLists.categories.planned.storageKey, []);
            const allSeries = [...watching, ...planned].filter(Utils.isSeries);
            
            for (const series of allSeries) {
                await this.checkSeries(series);
            }
            
            this.updateMenuBadge();
        },
        
        async checkSeries(series) {
            const tmdbId = Utils.getTmdbId(series);
            const lastCheck = this.lastChecked[tmdbId] || 0;
            
            // Не проверяем чаще раза в день
            if (Date.now() - lastCheck < 24 * 60 * 60 * 1000) return;
            
            this.lastChecked[tmdbId] = Date.now();
            
            if (Lampa.TMDB && Lampa.TMDB.api) {
                Lampa.TMDB.api.tv({ id: tmdbId }, (data) => {
                    if (data && data.seasons) {
                        const savedSeasons = series._favplus_seasons || 0;
                        const currentSeasons = data.seasons.length;
                        
                        if (currentSeasons > savedSeasons) {
                            this.newEpisodesCache.push({
                                series: series,
                                newSeason: currentSeasons,
                                date: new Date().toLocaleDateString()
                            });
                            
                            if (Settings.get('track_notify')) {
                                Lampa.Noty.show(`📺 Новый сезон ${Utils.cleanHtml(series.title)}!`, 5000);
                            }
                            
                            // Обновляем сохраненное количество сезонов
                            series._favplus_seasons = currentSeasons;
                            this._updateSeriesInLists(series);
                        }
                    }
                }, () => {});
            }
        },
        
        _updateSeriesInLists(updatedSeries) {
            for (const [key, cat] of Object.entries(SmartLists.categories)) {
                const items = Lampa.Storage.get(cat.storageKey, []);
                const index = items.findIndex(i => Utils.getTmdbId(i) === Utils.getTmdbId(updatedSeries));
                if (index !== -1) {
                    items[index] = { ...items[index], ...updatedSeries };
                    Lampa.Storage.set(cat.storageKey, items);
                }
            }
        },
        
        updateMenuBadge() {
            const count = this.newEpisodesCache.length;
            if (count > 0 && Lampa.Menu) {
                // Добавляем значок уведомления в меню
                $('.menu__item .menu__text').each(function() {
                    if ($(this).text() === 'Избранное+') {
                        const $badge = $(this).parent().find('.favplus-badge');
                        if (!$badge.length) {
                            $(this).parent().append(`<span class="favplus-badge">${count}</span>`);
                        } else {
                            $badge.text(count);
                        }
                    }
                });
            }
        }
    };
    
    // ==================== ИНИЦИАЛИЗАЦИЯ ПЛАГИНА ====================
    class FavoritesPlusPlugin {
        constructor() {
            this.name = 'favorites_plus';
            this.version = '1.0.0';
            this.description = 'Расширенная система избранного с умными списками';
        }
        
        start() {
            console.log(`Favorites Plus v${this.version} starting...`);
            
            // Инициализация модулей
            Settings.init();
            SmartLists.init();
            TimecodeManager.init();
            UIInjector.init();
            GistSync.init();
            NewEpisodesTracker.init();
            
            // Подписка на события плеера
            if (Lampa.Player && Lampa.Player.listener) {
                Lampa.Player.listener.follow('timeupdate', (e) => {
                    const currentItem = Lampa.Player.playdata();
                    if (currentItem && currentItem.card) {
                        const percent = e.duration > 0 ? (e.current / e.duration * 100) : 0;
                        const isSeries = Utils.isSeries(currentItem.card);
                        
                        // Сохраняем таймкод
                        TimecodeManager.saveTimecode(
                            currentItem.card,
                            TimecodeManager.getLampaKey(currentItem.card, currentItem.season, currentItem.episode),
                            e.current,
                            e.duration,
                            currentItem.season,
                            currentItem.episode
                        );
                        
                        // Проверяем авто-статусы
                        AutoStatus.checkAndUpdate(
                            currentItem.card,
                            e.current,
                            e.duration,
                            currentItem.season,
                            currentItem.episode
                        );
                    }
                });
                
                Lampa.Player.listener.follow('ended', () => {
                    const currentItem = Lampa.Player.playdata();
                    if (currentItem && currentItem.card) {
                        // При окончании просмотра проверяем статус
                        const progress = TimecodeManager.getProgress(currentItem.card);
                        AutoStatus.checkAndUpdate(
                            currentItem.card,
                            progress?.time || 0,
                            progress?.duration || 0,
                            currentItem.season,
                            currentItem.episode
                        );
                    }
                });
            }
            
            // Периодическая проверка брошенных и очистка
            setInterval(() => {
                AutoStatus.checkAbandoned();
                AutoStatus.cleanOldCompleted();
                TimecodeManager.cleanOldTimecodes(Settings.get('auto_clean_timecodes_days', 180));
            }, 24 * 60 * 60 * 1000); // Раз в день
            
            console.log(`Favorites Plus v${this.version} started!`);
        }
        
        stop() {
            console.log(`Favorites Plus v${this.version} stopped`);
            GistSync.stopAutoSync();
            NewEpisodesTracker.stopTracking();
        }
    }
    
    // Регистрация плагина
    if (typeof Lampa !== 'undefined' && Lampa.Plugin) {
        Lampa.Plugin.add(new FavoritesPlusPlugin());
    } else {
        console.error('Favorites Plus: Lampa or Lampa.Plugin not found');
    }
})();
