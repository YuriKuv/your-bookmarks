/**
 * Плагин "Избранное+" (Favorites Plus)
 * Версия: 1.0.0
 * Для установки через расширение Lampa
 */

(function() {
    // Ждем полной загрузки Lampa
    if (typeof Lampa === 'undefined') {
        console.log('Favorites Plus: waiting for Lampa...');
        return;
    }

    // ==================== КОНФИГУРАЦИЯ ПО УМОЛЧАНИЮ ====================
    const DEFAULT_SETTINGS = {
        auto_watching_enabled: true,
        auto_completed_enabled: true,
        auto_abandoned_enabled: true,
        watching_percent: 5,
        completed_percent: 95,
        abandoned_days: 30,
        poster_status_mode: 'favorites_plus',
        poster_status_position: 'bottom',
        hide_native_favorite_button: false,
        auto_clean_completed_days: 90,
        auto_clean_timecodes_days: 180,
        sync_enabled: false,
        sync_gist_id: '',
        sync_token: '',
        sync_interval_hours: 1,
        sync_strategy: 'duration',
        track_new_episodes: true,
        track_interval_hours: 6,
        track_notify: true,
        log_enabled: true,
        max_log_entries: 100
    };
    
    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
    const Utils = {
        generateTimecodeKey(item, season, episode) {
            if (item.type === 'tv' || item.name === 'tv' || (item.seasons && item.seasons.length)) {
                const tmdbId = item.id || item.tmdb_id;
                const seasonNum = season || item.season || 1;
                const episodeNum = episode || item.episode || 1;
                return `${tmdbId}_s${seasonNum}_e${episodeNum}`;
            }
            return String(item.id || item.tmdb_id);
        },
        
        cleanHtml(str) {
            if (!str) return '';
            return String(str).replace(/<[^>]*>/g, '').trim();
        },
        
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
        
        getRemainingTime(current, duration) {
            if (!duration) return '';
            return this.formatTime(duration - current);
        },
        
        clone(obj) {
            return JSON.parse(JSON.stringify(obj));
        },
        
        isSeries(item) {
            return item && (item.type === 'tv' || item.name === 'tv' || 
                   (item.number_of_seasons) || (item.seasons && item.seasons.length));
        },
        
        getTmdbId(item) {
            return item.id || item.tmdb_id || item.movie?.id;
        }
    };
    
    // ==================== МОДУЛЬ ХРАНЕНИЯ ====================
    const SmartLists = {
        categories: {
            watching:    { name: 'Смотрю', icon: '👁️', priority: 5, storageKey: 'favplus_watching' },
            favorite:    { name: 'Избранное', icon: '⭐', priority: 4, storageKey: 'favplus_favorite' },
            planned:     { name: 'Буду смотреть', icon: '📋', priority: 3, storageKey: 'favplus_planned' },
            abandoned:   { name: 'Брошено', icon: '❌', priority: 2, storageKey: 'favplus_abandoned' },
            collection:  { name: 'Коллекция', icon: '📦', priority: 1, storageKey: 'favplus_collection' },
            completed:   { name: 'Просмотрено', icon: '✅', priority: 0, storageKey: 'favplus_completed' }
        },
        
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
            
            while (log.length > Settings.get('max_log_entries', 100)) log.pop();
            Lampa.Storage.set('favplus_movements_log', log);
        },
        
        getAllLists() {
            const lists = {};
            for (const [key, cat] of Object.entries(this.categories)) {
                lists[key] = Lampa.Storage.get(cat.storageKey, []);
            }
            return lists;
        },
        
        findItem(itemId) {
            const lists = this.getAllLists();
            for (const [listName, items] of Object.entries(lists)) {
                const found = items.find(i => String(Utils.getTmdbId(i)) === String(itemId));
                if (found) return { list: listName, item: found };
            }
            return null;
        },
        
        addToList(listKey, item, skipLog = false) {
            const cat = this.categories[listKey];
            if (!cat) return false;
            
            const items = Lampa.Storage.get(cat.storageKey, []);
            const existingIndex = items.findIndex(i => Utils.getTmdbId(i) === Utils.getTmdbId(item));
            
            if (existingIndex === -1) {
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
        
        removeFromList(listKey, itemId, skipLog = false) {
            const cat = this.categories[listKey];
            if (!cat) return false;
            
            let items = Lampa.Storage.get(cat.storageKey, []);
            const removedItem = items.find(i => Utils.getTmdbId(i) === itemId);
            items = items.filter(i => Utils.getTmdbId(i) !== itemId);
            Lampa.Storage.set(cat.storageKey, items);
            if (!skipLog && removedItem) this.addLog(removedItem, listKey, null);
            return true;
        },
        
        moveBetweenLists(fromList, toList, item) {
            const itemId = Utils.getTmdbId(item);
            if (fromList) this.removeFromList(fromList, itemId, true);
            this.addToList(toList, item, true);
            this.addLog(item, fromList, toList);
            return true;
        },
        
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
        
        removeFromAllLists(itemId) {
            for (const [key, cat] of Object.entries(this.categories)) {
                this.removeFromList(key, itemId, true);
            }
        }
    };
    
    // ==================== МОДУЛЬ ТАЙМКОДОВ ====================
    const TimecodeManager = {
        keyMapping: {},
        
        init() {
            if (Lampa.Storage.get('favplus_key_mapping') === undefined) {
                Lampa.Storage.set('favplus_key_mapping', {});
            }
            this.keyMapping = Lampa.Storage.get('favplus_key_mapping', {});
        },
        
        getLampaKey(item, season, episode) {
            if (Utils.isSeries(item)) {
                return `${item.id}_s${season || item.season || 1}_e${episode || item.episode || 1}`;
            }
            return String(item.id);
        },
        
        getPluginKey(item, season, episode) {
            return Utils.generateTimecodeKey(item, season, episode);
        },
        
        saveMapping(lampaKey, pluginKey) {
            this.keyMapping[lampaKey] = pluginKey;
            Lampa.Storage.set('favplus_key_mapping', this.keyMapping);
        },
        
        getProgress(item, season, episode) {
            const pluginKey = this.getPluginKey(item, season, episode);
            const timecode = Lampa.Storage.get(`favplus_timecode_${pluginKey}`, null);
            
            if (timecode) return timecode;
            
            const lampaKey = this.getLampaKey(item, season, episode);
            const lampaTimecode = Lampa.Timeline.view(lampaKey);
            
            if (lampaTimecode && lampaTimecode.time) {
                this.saveTimecode(item, lampaKey, lampaTimecode.time, lampaTimecode.duration, season, episode);
                return lampaTimecode;
            }
            return null;
        },
        
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
            
            Lampa.Storage.set(`favplus_timecode_${pluginKey}`, timecodeData);
            this.saveMapping(lampaKey, pluginKey);
            
            if (Lampa.Timeline && Lampa.Timeline.save) {
                Lampa.Timeline.save(lampaKey, currentTime, duration);
            }
            return timecodeData;
        },
        
        deleteTimecode(item, season, episode) {
            const pluginKey = this.getPluginKey(item, season, episode);
            Lampa.Storage.set(`favplus_timecode_${pluginKey}`, null);
        },
        
        cleanOldTimecodes(days) {
            const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('favplus_timecode_')) {
                    const timecode = Lampa.Storage.get(key, null);
                    if (timecode && timecode.updated && timecode.updated < threshold) {
                        Lampa.Storage.set(key, null);
                    }
                }
            }
        }
    };
    
    // ==================== МОДУЛЬ АВТОМАТИЧЕСКИХ СТАТУСОВ ====================
    const AutoStatus = {
        checkAndUpdate(item, currentTime, duration, season, episode) {
            if (!item) return;
            
            const percent = duration > 0 ? (currentTime / duration * 100) : 0;
            const isSeries = Utils.isSeries(item);
            const itemId = Utils.getTmdbId(item);
            const currentStatus = SmartLists.getPrimaryStatus(itemId);
            
            if (Settings.get('auto_watching_enabled') && percent >= Settings.get('watching_percent')) {
                if (!currentStatus || currentStatus.name !== 'Смотрю') {
                    const isCompleted = SmartLists.categories.completed.storageKey === currentStatus?.storageKey;
                    if (!isCompleted) {
                        SmartLists.moveBetweenLists(currentStatus?.name?.toLowerCase(), 'watching', item);
                        this._notifyStatusChange(item, 'Смотрю');
                    }
                }
            }
            
            if (Settings.get('auto_completed_enabled') && percent >= Settings.get('completed_percent')) {
                if (!currentStatus || currentStatus.name !== 'Просмотрено') {
                    if (isSeries) {
                        this._isLastEpisode(item, season, episode, (isLast) => {
                            if (isLast) this._markAsCompleted(item, currentStatus);
                        });
                    } else {
                        this._markAsCompleted(item, currentStatus);
                    }
                }
            }
        },
        
        _markAsCompleted(item, currentStatus) {
            const itemId = Utils.getTmdbId(item);
            if (currentStatus && currentStatus.name !== 'Коллекция') {
                SmartLists.removeFromList(currentStatus.name.toLowerCase(), itemId, true);
            }
            SmartLists.addToList('completed', item, true);
            this._notifyStatusChange(item, 'Просмотрено');
        },
        
        _isLastEpisode(item, currentSeason, currentEpisode, callback) {
            const tmdbId = Utils.getTmdbId(item);
            if (!tmdbId || !Lampa.TMDB) {
                callback(true);
                return;
            }
            
            Lampa.TMDB.api.tv({ id: tmdbId }, (data) => {
                if (data && data.seasons && data.seasons.length) {
                    const lastSeason = data.seasons[data.seasons.length - 1];
                    const lastSeasonNumber = lastSeason.season_number;
                    const lastEpisodeCount = lastSeason.episode_count || 0;
                    callback(currentSeason >= lastSeasonNumber && currentEpisode >= lastEpisodeCount);
                } else {
                    callback(true);
                }
            }, () => callback(true));
        },
        
        checkAbandoned() {
            if (!Settings.get('auto_abandoned_enabled')) return;
            
            const watchingList = Lampa.Storage.get(SmartLists.categories.watching.storageKey, []);
            const threshold = Date.now() - (Settings.get('abandoned_days') * 24 * 60 * 60 * 1000);
            
            watchingList.forEach(item => {
                const timecode = TimecodeManager.getProgress(item);
                if (timecode && timecode.updated && timecode.updated < threshold) {
                    SmartLists.moveBetweenLists('watching', 'abandoned', item);
                    this._notifyStatusChange(item, 'Брошено');
                }
            });
        },
        
        cleanOldCompleted() {
            const days = Settings.get('auto_clean_completed_days');
            if (days <= 0) return;
            
            const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
            const completedList = Lampa.Storage.get(SmartLists.categories.completed.storageKey, []);
            const toRemove = completedList.filter(item => (item._favplus_added || 0) < threshold);
            
            toRemove.forEach(item => {
                SmartLists.removeFromList('completed', Utils.getTmdbId(item), true);
            });
        },
        
        _notifyStatusChange(item, newStatus) {
            if (Lampa.Noty) {
                Lampa.Noty.show(`${Utils.cleanHtml(item.title || item.name)} → ${newStatus}`, 3000);
            }
        }
    };
    
    // ==================== МОДУЛЬ UI ====================
    const UIInjector = {
        init() {
            this.addMenuButton();
            this.patchFullCard();
        },
        
        addMenuButton() {
            const checkExist = setInterval(() => {
                if ($('.menu__list').length && !$('.favplus-menu-item').length) {
                    const menuButton = $(`<li class="menu__item selector favplus-menu-item">
                        <div class="menu__ico">⭐</div>
                        <div class="menu__text">Избранное+</div>
                    </li>`);
                    
                    menuButton.on('hover:enter', () => this.showMainMenu());
                    $('.menu__list').eq(0).append(menuButton);
                    clearInterval(checkExist);
                }
            }, 1000);
        },
        
        patchFullCard() {
            // Перехватываем открытие полной карточки
            const originalPush = Lampa.Activity.push;
            Lampa.Activity.push = function(params) {
                if (params.component === 'full') {
                    setTimeout(() => this._addToFullCard(), 500);
                }
                return originalPush.call(this, params);
            }.bind(this);
        },
        
        _addToFullCard() {
            const $card = $('.full-info');
            if (!$card.length || $card.find('.favplus-status-block').length) return;
            
            const itemId = $card.find('.full-info__title').attr('data-id');
            const status = SmartLists.getPrimaryStatus(itemId);
            
            if (status) {
                const $statusBlock = $(`<div class="favplus-status-block" style="display:flex; align-items:center; gap:8px; margin-bottom:10px; padding:8px; background:rgba(255,255,255,0.1); border-radius:8px;">
                    <span style="font-size:24px;">${status.icon}</span>
                    <span style="font-size:14px;">Статус: ${status.name}</span>
                </div>`);
                $card.find('.full-info__about').prepend($statusBlock);
            }
            
            // Добавляем кастомную кнопку
            if (Settings.get('hide_native_favorite_button')) {
                $card.find('.full-info__favorite, .button--favorite').hide();
            }
            
            if (!$card.find('.favplus-favorite-btn').length) {
                const $btn = $(`<div class="button favplus-favorite-btn selector" style="margin-top:8px;">
                    <div class="button__icon">⭐</div>
                    <div class="button__text">В избранное+</div>
                </div>`);
                $btn.on('hover:enter', () => this.showCategoryMenu());
                $card.find('.full-info__buttons').append($btn);
            }
        },
        
        showCategoryMenu() {
            const itemId = $('.full-info__title').attr('data-id');
            const currentStatus = SmartLists.getPrimaryStatus(itemId);
            
            // Собираем данные о фильме из карточки
            const item = {
                id: itemId,
                title: $('.full-info__title').text(),
                original_title: $('.full-info__title').text(),
                type: $('.full-info__title').attr('data-type') || 'movie'
            };
            
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
                            Lampa.Noty.show(`Добавлено в ${SmartLists.categories[selected.listKey].name}`);
                        }
                    }
                });
            }
        },
        
        showMainMenu() {
            const items = [
                { title: '📋 Мои списки', action: 'showLists' },
                { title: '▶️ Продолжить просмотр', action: 'continueWatching' },
                { title: '🎲 Случайный фильм', action: 'randomMovie' },
                { title: '🔍 Поиск по избранному', action: 'searchFavorites' },
                { title: '📊 Статистика', action: 'showStats' },
                { title: '📜 История перемещений', action: 'showHistory' },
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
        
        showLists() {
            const items = [];
            for (const [key, cat] of Object.entries(SmartLists.categories)) {
                const count = Lampa.Storage.get(cat.storageKey, []).length;
                items.push({ title: `${cat.icon} ${cat.name} (${count})`, listKey: key });
            }
            
            Lampa.Select.show({
                title: 'Мои списки',
                items: items,
                onSelect: (selected) => {
                    const cat = SmartLists.categories[selected.listKey];
                    const listItems = Lampa.Storage.get(cat.storageKey, []);
                    this._showListItems(selected.listKey, listItems);
                }
            });
        },
        
        _showListItems(listKey, items) {
            if (!items.length) {
                Lampa.Noty.show('Список пуст');
                return;
            }
            
            const displayItems = items.slice(0, 30).map(item => ({
                title: item.title || item.name,
                item: item
            }));
            
            Lampa.Select.show({
                title: SmartLists.categories[listKey].name,
                items: displayItems,
                virtualScroll: true,
                onSelect: (selected) => {
                    if (selected.item && Lampa.Activity) {
                        Lampa.Activity.push({
                            component: 'full',
                            title: selected.item.title,
                            movie: selected.item,
                            id: Utils.getTmdbId(selected.item)
                        });
                    }
                }
            });
        },
        
        continueWatching() {
            const watchingList = Lampa.Storage.get(SmartLists.categories.watching.storageKey, []);
            let bestItem = null;
            let bestProgress = 0;
            
            watchingList.forEach(item => {
                const progress = TimecodeManager.getProgress(item);
                if (progress && progress.percent > 0 && progress.percent < 95 && progress.percent > bestProgress) {
                    bestProgress = progress.percent;
                    bestItem = item;
                }
            });
            
            if (bestItem && Lampa.Player && bestItem.url) {
                Lampa.Player.play({
                    url: bestItem.url,
                    title: bestItem.title,
                    card: bestItem,
                    timeline: TimecodeManager.getProgress(bestItem)
                });
            } else if (bestItem) {
                // Если нет URL, просто открываем карточку
                Lampa.Activity.push({
                    component: 'full',
                    title: bestItem.title,
                    movie: bestItem,
                    id: Utils.getTmdbId(bestItem)
                });
            } else {
                Lampa.Noty.show('Нет незавершенных просмотров');
            }
        },
        
        randomMovie() {
            const planned = Lampa.Storage.get(SmartLists.categories.planned.storageKey, []);
            const favorite = Lampa.Storage.get(SmartLists.categories.favorite.storageKey, []);
            const all = [...planned, ...favorite];
            
            if (all.length) {
                const random = all[Math.floor(Math.random() * all.length)];
                Lampa.Activity.push({
                    component: 'full',
                    title: random.title,
                    movie: random,
                    id: Utils.getTmdbId(random)
                });
            } else {
                Lampa.Noty.show('Нет фильмов в планах или избранном');
            }
        },
        
        searchFavorites() {
            if (!Lampa.Input) {
                Lampa.Noty.show('Поиск временно недоступен');
                return;
            }
            
            Lampa.Input.show({
                title: 'Поиск по избранному',
                onEnter: (query) => {
                    const results = [];
                    for (const [key, cat] of Object.entries(SmartLists.categories)) {
                        const items = Lampa.Storage.get(cat.storageKey, []);
                        const found = items.filter(i => 
                            (i.title || i.name || '').toLowerCase().includes(query.toLowerCase())
                        );
                        results.push(...found.map(i => ({ ...i, _listKey: key })));
                    }
                    
                    if (results.length) {
                        this._showListItems('search', results);
                    } else {
                        Lampa.Noty.show('Ничего не найдено');
                    }
                }
            });
        },
        
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
                    if (progress && progress.time) stats.totalTimeWatched += progress.time;
                });
            }
            
            const statsText = `📊 Статистика Избранное+\n─────────────────\n🎬 Фильмов: ${stats.totalMovies}\n📺 Сериалов: ${stats.totalSeries}\n⏱️ Просмотрено: ${Utils.formatTime(stats.totalTimeWatched)}\n─────────────────\n⭐ Избранное: ${stats.byCategory.favorite || 0}\n👁️ Смотрю: ${stats.byCategory.watching || 0}\n📋 Планы: ${stats.byCategory.planned || 0}\n✅ Просмотрено: ${stats.byCategory.completed || 0}\n❌ Брошено: ${stats.byCategory.abandoned || 0}\n📦 Коллекция: ${stats.byCategory.collection || 0}`;
            
            Lampa.Noty.show(statsText, 8000);
        },
        
        showHistory() {
            const log = Lampa.Storage.get('favplus_movements_log', []);
            if (!log.length) {
                Lampa.Noty.show('История пуста');
                return;
            }
            
            const items = log.slice(0, 30).map(entry => ({
                title: `${entry.itemTitle}\n${entry.from ? `Из: ${entry.from}` : 'Добавлено'} → ${entry.to || 'удалено'}\n${entry.date}`
            }));
            
            Lampa.Select.show({
                title: 'История перемещений',
                items: items,
                virtualScroll: true
            });
        },
        
        settings() {
            this.showSettingsDialog();
        },
        
        showSettingsDialog() {
            const items = [
                { title: `${Settings.get('auto_watching_enabled') ? '✅' : '❌'} Авто-Смотрю (${Settings.get('watching_percent')}%)`, action: 'toggle_watching' },
                { title: `${Settings.get('auto_completed_enabled') ? '✅' : '❌'} Авто-Просмотрено (${Settings.get('completed_percent')}%)`, action: 'toggle_completed' },
                { title: `${Settings.get('auto_abandoned_enabled') ? '✅' : '❌'} Авто-Брошено (${Settings.get('abandoned_days')} дн.)`, action: 'toggle_abandoned' },
                { title: `${Settings.get('track_new_episodes') ? '✅' : '❌'} Отслеживать новые серии`, action: 'toggle_track' },
                { title: `${Settings.get('hide_native_favorite_button') ? '✅' : '❌'} Скрыть штатную кнопку`, action: 'toggle_hide_native' },
                { title: '🗑️ Очистить все данные', action: 'clear_all' }
            ];
            
            Lampa.Select.show({
                title: '⚙️ Настройки Избранное+',
                items: items,
                onSelect: (selected) => {
                    switch(selected.action) {
                        case 'toggle_watching':
                            Settings.set('auto_watching_enabled', !Settings.get('auto_watching_enabled'));
                            break;
                        case 'toggle_completed':
                            Settings.set('auto_completed_enabled', !Settings.get('auto_completed_enabled'));
                            break;
                        case 'toggle_abandoned':
                            Settings.set('auto_abandoned_enabled', !Settings.get('auto_abandoned_enabled'));
                            break;
                        case 'toggle_track':
                            Settings.set('track_new_episodes', !Settings.get('track_new_episodes'));
                            break;
                        case 'toggle_hide_native':
                            Settings.set('hide_native_favorite_button', !Settings.get('hide_native_favorite_button'));
                            break;
                        case 'clear_all':
                            if (confirm('Очистить все данные Избранное+?')) {
                                for (const [key, cat] of Object.entries(SmartLists.categories)) {
                                    Lampa.Storage.set(cat.storageKey, []);
                                }
                                Lampa.Noty.show('Все данные очищены');
                                setTimeout(() => location.reload(), 1500);
                            }
                            break;
                    }
                    this.settings();
                }
            });
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
        }
    };
    
    // ==================== ИНИЦИАЛИЗАЦИЯ ====================
    function initPlugin() {
        console.log('Favorites Plus: initializing...');
        
        Settings.init();
        SmartLists.init();
        TimecodeManager.init();
        
        // Ждем готовности приложения
        if (window.appready) {
            UIInjector.init();
        } else {
            Lampa.Listener.follow('app', (e) => {
                if (e.type === 'ready') {
                    UIInjector.init();
                }
            });
        }
        
        // Подписка на события плеера
        if (Lampa.Player && Lampa.Player.listener) {
            Lampa.Player.listener.follow('timeupdate', (e) => {
                const currentItem = Lampa.Player.playdata();
                if (currentItem && currentItem.card) {
                    TimecodeManager.saveTimecode(
                        currentItem.card,
                        TimecodeManager.getLampaKey(currentItem.card, currentItem.season, currentItem.episode),
                        e.current,
                        e.duration,
                        currentItem.season,
                        currentItem.episode
                    );
                    
                    AutoStatus.checkAndUpdate(
                        currentItem.card,
                        e.current,
                        e.duration,
                        currentItem.season,
                        currentItem.episode
                    );
                }
            });
        }
        
        // Периодические проверки
        setInterval(() => {
            AutoStatus.checkAbandoned();
            AutoStatus.cleanOldCompleted();
        }, 24 * 60 * 60 * 1000);
        
        console.log('Favorites Plus: ready!');
    }
    
    // Запускаем после загрузки Lampa
    if (typeof Lampa !== 'undefined' && Lampa.Storage) {
        initPlugin();
    } else {
        document.addEventListener('lampa:ready', initPlugin);
        setTimeout(() => {
            if (typeof Lampa !== 'undefined') initPlugin();
        }, 3000);
    }
})();
