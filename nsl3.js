/**
 * Favorites Plus - Оптимизированная версия
 * Версия: 2.0.0
 * Требования: Lampa 3.2.0+
 */

(function() {
    if (typeof Lampa === 'undefined') {
        console.log('[FavPlus] Waiting for Lampa...');
        return;
    }

    // ==================== КОНФИГУРАЦИЯ ====================
    const CONFIG = {
        version: 2,
        profile_id: (() => {
            try {
                const account = Lampa.Storage.get('account', {});
                return String(account.profile?.id || 'default');
            } catch { return 'default'; }
        })(),
        storage_keys: {
            settings: 'favplus_settings_v2',
            favorites: 'favplus_favorites_v2',
            timecodes: 'favplus_timecodes_v2',
            history: 'favplus_history_v2',
            log: 'favplus_log_v2'
        },
        defaults: {
            auto_watching: true,
            auto_completed: true,
            auto_abandoned: true,
            watching_min: 5,
            watching_max: 95,
            completed_min: 95,
            abandoned_days: 30,
            auto_clean_completed_days: 90,
            hide_native_btn: false,
            poster_status: true,
            poster_position: 'bottom',
            sync_enabled: false,
            sync_gist_id: '',
            sync_token: '',
            sync_interval: 60,
            track_episodes: true,
            track_interval: 24,
            track_notify: true
        }
    };

    // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
    const Utils = {
        getTmdbId(item) {
            return item?.id || item?.tmdb_id || item?.movie?.id || null;
        },
        
        getBaseId(tmdbId) {
            return String(tmdbId || '').replace(/[_-].*$/, '');
        },
        
        getTitle(item) {
            return item?.title || item?.name || item?.movie?.title || 'Без названия';
        },
        
        isSeries(item) {
            return !!(item?.original_name || item?.name === 'tv' || item?.type === 'tv' || item?.number_of_seasons);
        },
        
        formatTime(seconds) {
            if (!seconds || seconds < 0) return '0:00';
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            return `${m}:${s.toString().padStart(2, '0')}`;
        },
        
        formatTimeShort(seconds) {
            if (!seconds) return '';
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            if (h > 0) return `${h}ч ${m}м`;
            if (m > 0) return `${m}м`;
            return `${Math.floor(seconds)}с`;
        },
        
        cleanCard(card) {
            const allowed = ['id', 'title', 'name', 'original_title', 'original_name', 
                'poster_path', 'backdrop_path', 'vote_average', 'release_date', 
                'first_air_date', 'overview', 'source', 'number_of_seasons'];
            const clean = {};
            allowed.forEach(k => { if (card[k] !== undefined) clean[k] = card[k]; });
            return clean;
        },
        
        getPosterUrl(card) {
            if (card?.poster_path && Lampa.TMDB?.image) {
                return Lampa.TMDB.image('t/p/w92' + card.poster_path);
            }
            return null;
        },
        
        getYear(card) {
            return (card?.release_date || card?.first_air_date || '').slice(0, 4);
        },
        
        showNotify(text, time = 3000) {
            if (Lampa.Noty) Lampa.Noty.show(text, time);
        }
    };

    // ==================== КАТЕГОРИИ ====================
    const Categories = {
        list: [
            { id: 'favorite', name: 'Избранное', icon: '⭐', priority: 5 },
            { id: 'watching', name: 'Смотрю', icon: '👁️', priority: 4 },
            { id: 'planned', name: 'Буду смотреть', icon: '📋', priority: 3 },
            { id: 'abandoned', name: 'Брошено', icon: '❌', priority: 2 },
            { id: 'collection', name: 'Коллекция', icon: '📦', priority: 1 },
            { id: 'completed', name: 'Просмотрено', icon: '✅', priority: 0 }
        ],
        
        get(id) { return this.list.find(c => c.id === id); },
        
        getPriority(id) { return this.get(id)?.priority ?? 99; },
        
        getHigherPriority(list) {
            return list.reduce((best, current) => 
                this.getPriority(current) < this.getPriority(best) ? current : best, list[0]);
        }
    };

    // ==================== ХРАНИЛИЩЕ ====================
    const Storage = {
        get(key) { return Lampa.Storage.get(CONFIG.storage_keys[key], this._getDefault(key)); },
        set(key, val) { Lampa.Storage.set(CONFIG.storage_keys[key], val, true); },
        
        _getDefault(key) {
            const defaults = {
                favorites: [],
                timecodes: {},
                history: [],
                log: []
            };
            return defaults[key] || {};
        },
        
        // Favorites
        getFavorites() { return this.get('favorites'); },
        saveFavorites(val) { this.set('favorites', val); this._emitChange(); },
        
        // Timecodes
        getTimecodes() { return this.get('timecodes'); },
        saveTimecodes(val) { this.set('timecodes', val); this._emitChange(); },
        
        // History
        getHistory() { return this.get('history'); },
        saveHistory(val) { 
            if (val.length > 50) val = val.slice(0, 50);
            this.set('history', val); 
        },
        
        // Log
        getLog() { return this.get('log'); },
        saveLog(val) { 
            if (val.length > 100) val = val.slice(0, 100);
            this.set('log', val); 
        },
        
        addLog(entry) {
            const log = this.getLog();
            log.unshift({ time: Date.now(), ...entry });
            this.saveLog(log);
        },
        
        _emitChange() {
            setTimeout(() => Lampa.Listener.send('state:changed', { target: 'favplus', reason: 'update' }), 100);
        }
    };

    // ==================== НАСТРОЙКИ ====================
    const Settings = {
        get() { return Lampa.Storage.get(CONFIG.storage_keys.settings, CONFIG.defaults); },
        set(key, val) {
            const s = this.get();
            s[key] = val;
            Lampa.Storage.set(CONFIG.storage_keys.settings, s, true);
        },
        getAll() { return this.get(); }
    };

    // ==================== ЛОГИКА ИЗБРАННОГО ====================
    const FavoritesManager = {
        // Поиск элемента
        findItem(tmdbId, category = null) {
            const baseId = Utils.getBaseId(tmdbId);
            const items = Storage.getFavorites();
            return items.filter(f => Utils.getBaseId(f.tmdb_id) === baseId && (!category || f.category === category));
        },
        
        // Получить статус элемента (главная категория)
        getStatus(tmdbId) {
            const items = this.findItem(tmdbId);
            if (!items.length) return null;
            const bestId = Categories.getHigherPriority(items.map(i => i.category));
            return Categories.get(bestId);
        },
        
        // Добавить в категорию
        add(card, category) {
            const tmdbId = Utils.getTmdbId(card);
            if (!tmdbId) return false;
            
            const baseId = Utils.getBaseId(tmdbId);
            let favorites = Storage.getFavorites();
            
            // Проверяем правила (при добавлении в некоторые категории удаляем из других)
            const removeRules = {
                completed: ['favorite', 'watching', 'planned'],
                watching: ['planned'],
                abandoned: ['favorite', 'watching', 'planned']
            };
            
            if (removeRules[category]) {
                favorites = favorites.filter(f => 
                    Utils.getBaseId(f.tmdb_id) !== baseId || !removeRules[category].includes(f.category)
                );
            }
            
            // Проверяем, есть ли уже в этой категории
            const existing = favorites.find(f => Utils.getBaseId(f.tmdb_id) === baseId && f.category === category);
            
            if (!existing) {
                favorites.push({
                    id: Date.now(),
                    tmdb_id: baseId,
                    category: category,
                    data: Utils.cleanCard(card),
                    added: Date.now(),
                    updated: Date.now()
                });
                
                Storage.saveFavorites(favorites);
                Storage.addLog({ action: 'add', title: Utils.getTitle(card), category });
                Utils.showNotify(`${Categories.get(category)?.icon} Добавлено в ${Categories.get(category)?.name}`);
                
                // Авто-синхронизация
                if (Settings.get().sync_enabled) GistSync.sync('favorites');
                return true;
            }
            return false;
        },
        
        // Удалить из категории
        remove(tmdbId, category) {
            const baseId = Utils.getBaseId(tmdbId);
            let favorites = Storage.getFavorites();
            const removed = favorites.find(f => Utils.getBaseId(f.tmdb_id) === baseId && f.category === category);
            
            if (removed) {
                favorites = favorites.filter(f => !(Utils.getBaseId(f.tmdb_id) === baseId && f.category === category));
                Storage.saveFavorites(favorites);
                Storage.addLog({ action: 'remove', title: Utils.getTitle(removed.data), category });
                Utils.showNotify(`🗑️ Удалено из ${Categories.get(category)?.name}`);
                
                if (Settings.get().sync_enabled) GistSync.sync('favorites');
                return true;
            }
            return false;
        },
        
        // Полностью удалить из всех категорий
        deleteCompletely(tmdbId) {
            const baseId = Utils.getBaseId(tmdbId);
            const items = this.findItem(baseId);
            const title = items[0]?.data?.title || 'Без названия';
            
            // Удаляем из избранного
            let favorites = Storage.getFavorites();
            favorites = favorites.filter(f => Utils.getBaseId(f.tmdb_id) !== baseId);
            Storage.saveFavorites(favorites);
            
            // Удаляем таймкоды
            let timecodes = Storage.getTimecodes();
            for (const key in timecodes) {
                if (Utils.getBaseId(timecodes[key].tmdb_id) === baseId) {
                    delete timecodes[key];
                }
            }
            Storage.saveTimecodes(timecodes);
            
            // Удаляем из истории
            let history = Storage.getHistory();
            history = history.filter(h => Utils.getBaseId(h.tmdb_id) !== baseId);
            Storage.saveHistory(history);
            
            // Очищаем file_view Lampa
            const fileView = Lampa.Storage.get('file_view', {});
            for (const key in fileView) {
                if (String(key).includes(baseId)) delete fileView[key];
            }
            Lampa.Storage.set('file_view', fileView, true);
            
            Storage.addLog({ action: 'delete_all', title });
            Utils.showNotify(`💥 "${title}" полностью удалён`);
            
            if (Settings.get().sync_enabled) {
                GistSync.sync('favorites');
                GistSync.sync('timecodes');
            }
        },
        
        // Переместить между категориями
        move(card, fromCategory, toCategory) {
            const tmdbId = Utils.getTmdbId(card);
            this.remove(tmdbId, fromCategory);
            this.add(card, toCategory);
        },
        
        // Получить все элементы категории
        getByCategory(category) {
            return Storage.getFavorites().filter(f => f.category === category);
        },
        
        // Очистить все
        clearAll() {
            Storage.saveFavorites([]);
            Storage.addLog({ action: 'clear_all', title: 'Все данные' });
            Utils.showNotify('🗑️ Избранное очищено');
            if (Settings.get().sync_enabled) GistSync.sync('favorites');
        }
    };

    // ==================== ТАЙМКОДЫ ====================
    const TimecodeManager = {
        // Генерация ключа
        getKey(card, season = null, episode = null) {
            const tmdbId = Utils.getTmdbId(card);
            if (!tmdbId) return null;
            
            if (Utils.isSeries(card) && (season || episode)) {
                const s = season || card.season || 1;
                const e = episode || card.episode || 1;
                return `${tmdbId}_s${s}_e${e}`;
            }
            return String(tmdbId);
        },
        
        // Получить прогресс
        get(tmdbId, season = null, episode = null) {
            const key = this.getKey({ id: tmdbId, original_name: season ? 'tv' : null }, season, episode);
            if (!key) return null;
            return Storage.getTimecodes()[key] || null;
        },
        
        // Сохранить прогресс
        save(card, currentTime, duration, season = null, episode = null) {
            const key = this.getKey(card, season, episode);
            if (!key) return false;
            
            const percent = duration > 0 ? Math.round((currentTime / duration) * 100) : 0;
            const tmdbId = Utils.getTmdbId(card);
            
            const timecodes = Storage.getTimecodes();
            const existing = timecodes[key];
            
            // Сохраняем только если прогресс увеличился
            if (!existing || currentTime > (existing.time || 0)) {
                timecodes[key] = {
                    time: currentTime,
                    duration: duration,
                    percent: percent,
                    updated: Date.now(),
                    tmdb_id: Utils.getBaseId(tmdbId)
                };
                Storage.saveTimecodes(timecodes);
                
                // Синхронизируем с file_view Lampa
                this._syncToFileView(card, key, currentTime, duration, percent);
                return true;
            }
            return false;
        },
        
        // Синхронизация с file_view Lampa
        _syncToFileView(card, key, time, duration, percent) {
            try {
                let hash = null;
                const name = card.original_name || card.original_title || card.title || '';
                
                if (key.includes('_s') && key.includes('_e')) {
                    const match = key.match(/_s(\d+)_e(\d+)/);
                    if (match && name) {
                        const raw = [match[1], match[1] > 10 ? ':' : '', match[2], name].join('');
                        hash = Lampa.Utils.hash(raw);
                    }
                } else if (name) {
                    hash = Lampa.Utils.hash(name);
                }
                
                if (hash) {
                    const fileView = Lampa.Storage.get('file_view', {});
                    fileView[hash] = { time, duration, percent, date: Date.now() };
                    Lampa.Storage.set('file_view', fileView, true);
                }
            } catch(e) {}
        },
        
        // Получить лучший прогресс для сериала
        getBestForSeries(tmdbId) {
            const baseId = Utils.getBaseId(tmdbId);
            const timecodes = Storage.getTimecodes();
            let best = null;
            
            for (const [key, val] of Object.entries(timecodes)) {
                if (Utils.getBaseId(val.tmdb_id) === baseId) {
                    if (!best || (val.percent || 0) > (best.percent || 0)) {
                        best = { key, ...val };
                    }
                }
            }
            return best;
        },
        
        // Очистить старые таймкоды
        cleanOld(days) {
            const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
            let timecodes = Storage.getTimecodes();
            let removed = 0;
            
            for (const [key, val] of Object.entries(timecodes)) {
                if ((val.updated || 0) < threshold) {
                    delete timecodes[key];
                    removed++;
                }
            }
            
            if (removed) {
                Storage.saveTimecodes(timecodes);
                Utils.showNotify(`🧹 Удалено таймкодов: ${removed}`);
            }
        }
    };

    // ==================== АВТОМАТИЧЕСКИЕ СТАТУСЫ ====================
    const AutoStatus = {
        lastSeriesCheck: {},
        
        // Проверка при обновлении таймкода
        check(card, percent, season, episode) {
            const settings = Settings.get();
            const tmdbId = Utils.getTmdbId(card);
            if (!tmdbId) return;
            
            const currentStatus = FavoritesManager.getStatus(tmdbId);
            const isSeries = Utils.isSeries(card);
            
            // Авто-Смотрю (5-95%)
            if (settings.auto_watching && percent >= settings.watching_min && percent <= settings.watching_max) {
                if (!currentStatus || currentStatus.id === 'planned' || currentStatus.id === 'favorite') {
                    FavoritesManager.add(card, 'watching');
                }
            }
            
            // Авто-Просмотрено (≥95%)
            if (settings.auto_completed && percent >= settings.completed_min) {
                if (currentStatus?.id !== 'completed') {
                    if (isSeries) {
                        this._checkLastEpisode(card, season, episode, (isLast) => {
                            if (isLast) FavoritesManager.add(card, 'completed');
                        });
                    } else {
                        FavoritesManager.add(card, 'completed');
                    }
                }
            }
        },
        
        // Проверка последней серии
        _checkLastEpisode(card, season, episode, callback) {
            const tmdbId = Utils.getTmdbId(card);
            const baseId = Utils.getBaseId(tmdbId);
            
            // Проверяем через Lampa TimeTable
            const timetable = Lampa.TimeTable?.all?.() || [];
            const showData = timetable.find(t => t.id == baseId);
            
            if (showData && showData.season > 0) {
                const isLastSeason = season >= showData.season;
                let lastEpisode = 0;
                if (showData.episodes) {
                    lastEpisode = Math.max(...showData.episodes.map(e => e.episode_number || 0));
                }
                callback(isLastSeason && episode >= lastEpisode);
            } else {
                // Fallback через TMDB API
                if (Lampa.TMDB?.api) {
                    const cache = this.lastSeriesCheck[baseId];
                    if (cache && Date.now() - cache.time < 3600000) {
                        callback(cache.isLast);
                        return;
                    }
                    
                    Lampa.TMDB.api.tv({ id: baseId }, (data) => {
                        const seasonsCount = data.number_of_seasons || 0;
                        const isLast = season >= seasonsCount;
                        this.lastSeriesCheck[baseId] = { time: Date.now(), isLast };
                        callback(isLast);
                    }, () => callback(false));
                } else {
                    callback(false);
                }
            }
        },
        
        // Проверка брошенных
        checkAbandoned() {
            const settings = Settings.get();
            if (!settings.auto_abandoned) return;
            
            const threshold = Date.now() - (settings.abandoned_days * 24 * 60 * 60 * 1000);
            const watching = FavoritesManager.getByCategory('watching');
            let changed = false;
            
            watching.forEach(item => {
                const lastUpdate = item.updated || item.added;
                if (lastUpdate < threshold) {
                    FavoritesManager.move(item.data, 'watching', 'abandoned');
                    changed = true;
                }
            });
            
            if (changed && settings.sync_enabled) GistSync.sync('favorites');
        },
        
        // Очистка старых просмотренных
        cleanCompleted() {
            const settings = Settings.get();
            if (!settings.auto_clean_completed_days) return;
            
            const threshold = Date.now() - (settings.auto_clean_completed_days * 24 * 60 * 60 * 1000);
            const completed = FavoritesManager.getByCategory('completed');
            let removed = 0;
            
            completed.forEach(item => {
                const completedAt = item.updated || item.added;
                if (completedAt < threshold) {
                    FavoritesManager.remove(item.tmdb_id, 'completed');
                    removed++;
                }
            });
            
            if (removed) Utils.showNotify(`🧹 Удалено просмотренных: ${removed}`);
        }
    };

    // ==================== ОТСЛЕЖИВАНИЕ НОВЫХ СЕРИЙ ====================
    const EpisodeTracker = {
        lastCheck: {},
        newEpisodes: [],
        timer: null,
        
        start() {
            if (!Settings.get().track_episodes) return;
            if (this.timer) clearInterval(this.timer);
            this.timer = setInterval(() => this.check(), Settings.get().track_interval * 60 * 60 * 1000);
            setTimeout(() => this.check(), 30000);
        },
        
        check() {
            const watching = FavoritesManager.getByCategory('watching');
            const planned = FavoritesManager.getByCategory('planned');
            const seriesList = [...watching, ...planned].filter(f => Utils.isSeries(f.data));
            
            seriesList.forEach(item => this._checkSeries(item));
        },
        
        _checkSeries(item) {
            const baseId = Utils.getBaseId(item.tmdb_id);
            const lastCheck = this.lastCheck[baseId] || 0;
            if (Date.now() - lastCheck < 3600000) return;
            
            this.lastCheck[baseId] = Date.now();
            
            if (Lampa.TMDB?.api) {
                Lampa.TMDB.api.tv({ id: baseId }, (data) => {
                    const newSeasons = data.number_of_seasons || 0;
                    const oldSeasons = item.data?.number_of_seasons || 0;
                    
                    if (newSeasons > oldSeasons && oldSeasons > 0) {
                        const isNew = !this.newEpisodes.some(e => e.id === baseId);
                        if (isNew) {
                            this.newEpisodes.push({
                                id: baseId,
                                title: data.name || item.data?.title,
                                oldSeasons,
                                newSeasons,
                                poster: data.poster_path
                            });
                            
                            if (Settings.get().track_notify) {
                                Utils.showNotify(`🔔 Новый сезон: ${data.name || item.data?.title} (S${newSeasons})`, 5000);
                            }
                            
                            // Обновляем данные
                            item.data.number_of_seasons = newSeasons;
                            Storage.saveFavorites(Storage.getFavorites());
                            this._updateBadge();
                        }
                    }
                });
            }
        },
        
        getCount() { return this.newEpisodes.length; },
        
        getList() { return this.newEpisodes; },
        
        markSeen(id) {
            this.newEpisodes = this.newEpisodes.filter(e => e.id !== id);
            this._updateBadge();
        },
        
        markAllSeen() {
            this.newEpisodes = [];
            this._updateBadge();
        },
        
        _updateBadge() {
            const count = this.getCount();
            $('.favplus-menu-badge').remove();
            if (count > 0) {
                $('.favplus-menu-item .menu__text').append(`<span class="favplus-menu-badge" style="background:#f44336;color:#fff;border-radius:10px;padding:0 6px;margin-left:8px;font-size:11px;">${count}</span>`);
            }
        }
    };

    // ==================== UI КОМПОНЕНТЫ ====================
    const UI = {
        // Добавление пункта в меню
        addMenuButton() {
            if ($('.favplus-menu-item').length) return;
            
            const $menu = $('.menu__list').first();
            if (!$menu.length) return;
            
            const $btn = $(`
                <li class="menu__item selector favplus-menu-item">
                    <div class="menu__ico">⭐</div>
                    <div class="menu__text">Избранное+</div>
                </li>
            `);
            
            $btn.on('hover:enter', () => this.showMainMenu());
            $menu.append($btn);
        },
        
        // Главное меню
        showMainMenu() {
            const stats = {};
            Categories.list.forEach(c => { stats[c.id] = FavoritesManager.getByCategory(c.id).length; });
            const total = Object.values(stats).reduce((a, b) => a + b, 0);
            
            const items = [
                { title: `📊 Статистика (${total})`, action: 'stats' },
                { title: '──────────', separator: true },
                ...Categories.list.map(c => ({ 
                    title: `${c.icon} ${c.name} (${stats[c.id] || 0})`, 
                    action: 'list', category: c.id 
                })),
                { title: '──────────', separator: true },
                { title: '▶️ Продолжить просмотр', action: 'continue' },
                { title: '🎲 Случайный фильм', action: 'random' },
                { title: '🔍 Поиск', action: 'search' },
                { title: '📜 История', action: 'history' },
                { title: '⚙️ Настройки', action: 'settings' }
            ];
            
            Lampa.Select.show({
                title: '⭐ Избранное+',
                items: items,
                onSelect: (item) => {
                    if (item.action === 'stats') this.showStats();
                    else if (item.action === 'list') this.showCategoryList(item.category);
                    else if (item.action === 'continue') this.continueWatching();
                    else if (item.action === 'random') this.randomMovie();
                    else if (item.action === 'search') this.searchFavorites();
                    else if (item.action === 'history') this.showHistory();
                    else if (item.action === 'settings') this.showSettings();
                }
            });
        },
        
        // Показать список категории
        showCategoryList(categoryId) {
            const cat = Categories.get(categoryId);
            const items = FavoritesManager.getByCategory(categoryId);
            
            if (!items.length) {
                Utils.showNotify(`📭 ${cat.name} пуст`);
                return;
            }
            
            const displayItems = items.map(item => {
                const data = item.data;
                const year = Utils.getYear(data);
                const poster = Utils.getPosterUrl(data);
                const progress = TimecodeManager.getBestForSeries(item.tmdb_id);
                const progressText = progress?.percent ? ` · ${progress.percent}%` : '';
                
                return {
                    title: `<div style="display:flex;align-items:center;gap:10px;">
                        ${poster ? `<img src="${poster}" style="width:40px;height:60px;object-fit:cover;border-radius:4px;">` : '<div style="width:40px;height:60px;background:#333;border-radius:4px;display:flex;align-items:center;justify-content:center;">🎬</div>'}
                        <div>
                            <div>${Utils.getTitle(data)}${year ? ` (${year})` : ''}</div>
                            <div style="font-size:11px;opacity:0.7;">${cat.icon} ${cat.name}${progressText}</div>
                        </div>
                    </div>`,
                    item: data
                };
            });
            
            displayItems.push({ title: '──────────', separator: true });
            displayItems.push({ title: '◀ Назад', action: 'back' });
            
            Lampa.Select.show({
                title: `${cat.icon} ${cat.name} (${items.length})`,
                items: displayItems,
                virtualScroll: true,
                onSelect: (selected) => {
                    if (selected.action === 'back') this.showMainMenu();
                    else if (selected.item) this.openCard(selected.item);
                },
                onLongPress: (selected) => {
                    if (selected.item) {
                        this.showItemActions(selected.item, categoryId);
                    }
                }
            });
        },
        
        // Действия с элементом
        showItemActions(card, currentCategory) {
            const items = [
                { title: '📋 Переместить в...', action: 'move' },
                { title: `🗑️ Удалить из ${Categories.get(currentCategory)?.name}`, action: 'remove' },
                { title: '💥 Удалить полностью', action: 'delete_all' },
                { title: '❌ Отмена', action: 'cancel' }
            ];
            
            Lampa.Select.show({
                title: Utils.getTitle(card),
                items: items,
                onSelect: (item) => {
                    if (item.action === 'move') this.showMoveMenu(card, currentCategory);
                    else if (item.action === 'remove') {
                        FavoritesManager.remove(Utils.getTmdbId(card), currentCategory);
                        this.showCategoryList(currentCategory);
                    } else if (item.action === 'delete_all') {
                        FavoritesManager.deleteCompletely(Utils.getTmdbId(card));
                        this.showCategoryList(currentCategory);
                    }
                }
            });
        },
        
        // Меню перемещения
        showMoveMenu(card, fromCategory) {
            const items = Categories.list
                .filter(c => c.id !== fromCategory)
                .map(c => ({ title: `${c.icon} ${c.name}`, action: 'move', toCategory: c.id }));
            items.push({ title: '❌ Отмена', action: 'cancel' });
            
            Lampa.Select.show({
                title: `Переместить "${Utils.getTitle(card)}"`,
                items: items,
                onSelect: (item) => {
                    if (item.action === 'move') {
                        FavoritesManager.move(card, fromCategory, item.toCategory);
                        this.showCategoryList(fromCategory);
                    }
                }
            });
        },
        
        // Открыть карточку
        openCard(card) {
            const method = Utils.isSeries(card) ? 'tv' : 'movie';
            Lampa.Activity.push({
                component: 'full',
                method: method,
                movie: card,
                title: Utils.getTitle(card),
                id: Utils.getTmdbId(card)
            });
        },
        
        // Продолжить просмотр
        continueWatching() {
            const watching = FavoritesManager.getByCategory('watching');
            let best = null;
            let bestPercent = 0;
            
            watching.forEach(item => {
                const progress = TimecodeManager.getBestForSeries(item.tmdb_id);
                if (progress && progress.percent > 0 && progress.percent < 95 && progress.percent > bestPercent) {
                    bestPercent = progress.percent;
                    best = item;
                }
            });
            
            if (best) {
                this.openCard(best.data);
                Utils.showNotify(`▶️ Продолжаем: ${Utils.getTitle(best.data)}`);
            } else {
                Utils.showNotify('Нет незавершённых просмотров');
            }
        },
        
        // Случайный фильм
        randomMovie() {
            const planned = FavoritesManager.getByCategory('planned');
            const favorite = FavoritesManager.getByCategory('favorite');
            const all = [...planned, ...favorite];
            
            if (all.length) {
                const random = all[Math.floor(Math.random() * all.length)];
                this.openCard(random.data);
                Utils.showNotify(`🎲 Случайный выбор: ${Utils.getTitle(random.data)}`);
            } else {
                Utils.showNotify('Нет фильмов в планах или избранном');
            }
        },
        
        // Поиск
        searchFavorites() {
            Lampa.Input?.edit({
                title: 'Поиск по избранному',
                value: '',
                free: true
            }, (query) => {
                if (!query?.trim()) return;
                
                const all = Storage.getFavorites();
                const results = all.filter(f => 
                    Utils.getTitle(f.data).toLowerCase().includes(query.toLowerCase())
                );
                
                if (!results.length) {
                    Utils.showNotify('Ничего не найдено');
                    return;
                }
                
                const items = results.map(f => ({
                    title: Utils.getTitle(f.data),
                    item: f.data
                }));
                
                Lampa.Select.show({
                    title: `🔍 Найдено: ${results.length}`,
                    items: items,
                    onSelect: (selected) => this.openCard(selected.item)
                });
            });
        },
        
        // История
        showHistory() {
            const history = Storage.getHistory();
            if (!history.length) {
                Utils.showNotify('История пуста');
                return;
            }
            
            const items = history.map(h => ({
                title: `${Utils.getTitle(h.data)}\n${new Date(h.time).toLocaleString()}`,
                item: h.data
            }));
            
            items.push({ title: '──────────', separator: true });
            items.push({ title: '🗑️ Очистить историю', action: 'clear' });
            
            Lampa.Select.show({
                title: '📜 История просмотров',
                items: items,
                onSelect: (selected) => {
                    if (selected.action === 'clear') {
                        Storage.saveHistory([]);
                        Utils.showNotify('История очищена');
                    } else if (selected.item) {
                        this.openCard(selected.item);
                    }
                }
            });
        },
        
        // Статистика
        showStats() {
            const stats = {};
            Categories.list.forEach(c => { stats[c.id] = FavoritesManager.getByCategory(c.id).length; });
            
            const timecodes = Storage.getTimecodes();
            let totalTime = 0;
            Object.values(timecodes).forEach(t => { totalTime += t.time || 0; });
            
            const text = `⭐ СТАТИСТИКА\n────────────────\n` +
                Categories.list.map(c => `${c.icon} ${c.name}: ${stats[c.id] || 0}`).join('\n') +
                `\n────────────────\n⏱️ Всего просмотрено: ${Utils.formatTimeShort(totalTime)}`;
            
            Utils.showNotify(text, 8000);
        },
        
        // Настройки
        showSettings() {
            const s = Settings.get();
            
            const items = [
                { title: `${s.auto_watching ? '✅' : '❌'} Авто-Смотрю (${s.watching_min}-${s.watching_max}%)`, action: 'toggle_watching' },
                { title: `${s.auto_completed ? '✅' : '❌'} Авто-Просмотрено (${s.completed_min}%)`, action: 'toggle_completed' },
                { title: `${s.auto_abandoned ? '✅' : '❌'} Авто-Брошено (${s.abandoned_days} дн.)`, action: 'toggle_abandoned' },
                { title: '──────────', separator: true },
                { title: `${s.track_episodes ? '✅' : '❌'} Отслеживать новые серии`, action: 'toggle_track' },
                { title: `${s.hide_native_btn ? '✅' : '❌'} Скрыть штатную кнопку`, action: 'toggle_hide' },
                { title: '──────────', separator: true },
                { title: '☁️ GitHub Gist синхронизация', action: 'gist' },
                { title: '🗑️ Очистить все данные', action: 'clear_all' }
            ];
            
            Lampa.Select.show({
                title: '⚙️ Настройки',
                items: items,
                onSelect: (item) => {
                    if (item.action === 'toggle_watching') {
                        Settings.set('auto_watching', !s.auto_watching);
                        this.showSettings();
                    } else if (item.action === 'toggle_completed') {
                        Settings.set('auto_completed', !s.auto_completed);
                        this.showSettings();
                    } else if (item.action === 'toggle_abandoned') {
                        Settings.set('auto_abandoned', !s.auto_abandoned);
                        this.showSettings();
                    } else if (item.action === 'toggle_track') {
                        Settings.set('track_episodes', !s.track_episodes);
                        if (s.track_episodes) EpisodeTracker.start();
                        this.showSettings();
                    } else if (item.action === 'toggle_hide') {
                        Settings.set('hide_native_btn', !s.hide_native_btn);
                        this._toggleNativeButton();
                        this.showSettings();
                    } else if (item.action === 'gist') {
                        this.showGistSettings();
                    } else if (item.action === 'clear_all') {
                        FavoritesManager.clearAll();
                        Storage.saveTimecodes({});
                        Storage.saveHistory([]);
                        Utils.showNotify('✅ Все данные очищены');
                        setTimeout(() => location.reload(), 1500);
                    }
                }
            });
        },
        
        // Настройки Gist
        showGistSettings() {
            const s = Settings.get();
            
            const items = [
                { title: `🔑 Токен: ${s.sync_token ? '✓ Установлен' : '❌ Не установлен'}`, action: 'token' },
                { title: `📄 Gist ID: ${s.sync_gist_id ? s.sync_gist_id.slice(0, 8) + '…' : '❌ Не установлен'}`, action: 'id' },
                { title: `🔄 Интервал: ${s.sync_interval} мин.`, action: 'interval' },
                { title: '──────────', separator: true },
                { title: '📤 Экспорт на Gist', action: 'upload' },
                { title: '📥 Импорт с Gist', action: 'download' },
                { title: '◀ Назад', action: 'back' }
            ];
            
            Lampa.Select.show({
                title: '☁️ GitHub Gist',
                items: items,
                onSelect: (item) => {
                    if (item.action === 'token') {
                        Lampa.Input?.edit({ title: 'GitHub Token', value: s.sync_token, free: true }, (val) => {
                            if (val !== null) Settings.set('sync_token', val);
                            this.showGistSettings();
                        });
                    } else if (item.action === 'id') {
                        Lampa.Input?.edit({ title: 'Gist ID', value: s.sync_gist_id, free: true }, (val) => {
                            if (val !== null) Settings.set('sync_gist_id', val);
                            this.showGistSettings();
                        });
                    } else if (item.action === 'interval') {
                        Lampa.Input?.edit({ title: 'Интервал (минут)', value: String(s.sync_interval), free: true, number: true }, (val) => {
                            if (val && !isNaN(val)) Settings.set('sync_interval', parseInt(val));
                            this.showGistSettings();
                        });
                    } else if (item.action === 'upload') {
                        GistSync.syncAll();
                        Utils.showNotify('📤 Синхронизация...');
                    } else if (item.action === 'download') {
                        GistSync.download();
                    } else if (item.action === 'back') {
                        this.showSettings();
                    }
                }
            });
        },
        
        // Скрытие/показ штатной кнопки
        _toggleNativeButton() {
            if (Settings.get().hide_native_btn) {
                $('.full-start__button.button--book, .button--favorite').hide();
            } else {
                $('.full-start__button.button--book, .button--favorite').show();
            }
        }
    };

    // ==================== GITHUB GIST СИНХРОНИЗАЦИЯ ====================
    const GistSync = {
        isSyncing: false,
        
        async sync(type) {
            const s = Settings.get();
            if (!s.sync_enabled || !s.sync_token || !s.sync_gist_id) return;
            if (this.isSyncing) return;
            
            this.isSyncing = true;
            
            const data = {
                favorites: Storage.getFavorites(),
                timecodes: Storage.getTimecodes(),
                history: Storage.getHistory(),
                updated: Date.now()
            };
            
            try {
                await fetch(`https://api.github.com/gists/${s.sync_gist_id}`, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `token ${s.sync_token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        files: { [`favplus_${type}.json`]: { content: JSON.stringify(data) } }
                    })
                });
            } catch(e) {}
            
            this.isSyncing = false;
        },
        
        syncAll() {
            this.sync('favorites');
            this.sync('timecodes');
        },
        
        async download() {
            const s = Settings.get();
            if (!s.sync_token || !s.sync_gist_id) return;
            
            try {
                const res = await fetch(`https://api.github.com/gists/${s.sync_gist_id}`, {
                    headers: { 'Authorization': `token ${s.sync_token}` }
                });
                const gist = await res.json();
                
                for (const [name, file] of Object.entries(gist.files)) {
                    if (name.includes('favorites')) {
                        const data = JSON.parse(file.content);
                        if (data.favorites) Storage.saveFavorites(data.favorites);
                    }
                    if (name.includes('timecodes')) {
                        const data = JSON.parse(file.content);
                        if (data.timecodes) Storage.saveTimecodes(data.timecodes);
                    }
                }
                
                Utils.showNotify('📥 Данные загружены с Gist');
            } catch(e) {
                Utils.showNotify('❌ Ошибка загрузки');
            }
        }
    };

    // ==================== ИСТОРИЯ ПРОСМОТРОВ ====================
    const HistoryManager = {
        add(card) {
            const tmdbId = Utils.getTmdbId(card);
            if (!tmdbId) return;
            
            let history = Storage.getHistory();
            history = history.filter(h => Utils.getTmdbId(h.data) !== tmdbId);
            history.unshift({ id: Date.now(), tmdb_id: tmdbId, data: Utils.cleanCard(card), time: Date.now() });
            Storage.saveHistory(history);
        }
    };

    // ==================== КНОПКИ НА КАРТОЧКЕ ====================
    const CardButtons = {
        init() {
            this.patchFullCard();
            this.addPosterStatus();
        },
        
        patchFullCard() {
            const originalPush = Lampa.Activity.push;
            Lampa.Activity.push = function(params) {
                const result = originalPush.call(this, params);
                if (params.component === 'full') {
                    setTimeout(() => CardButtons._addToCard(), 200);
                    setTimeout(() => CardButtons._addToCard(), 500);
                }
                return result;
            };
        },
        
        _addToCard() {
            const $container = $('.full-start-new__buttons, .full-start__buttons').first();
            if (!$container.length || $container.find('.favplus-card-btn').length) return;
            
            const movie = Lampa.Activity.active()?.movie;
            if (!movie) return;
            
            const status = FavoritesManager.getStatus(Utils.getTmdbId(movie));
            
            const $btn = $(`
                <div class="full-start__button selector favplus-card-btn" style="position:relative;">
                    <div style="font-size:18px;">${status?.icon || '⭐'}</div>
                    <span>${status?.name || 'Избранное+'}</span>
                </div>
            `);
            
            $btn.on('hover:enter', () => this._showCategoryMenu(movie));
            $container.append($btn);
            
            if (Settings.get().hide_native_btn) {
                $container.find('.button--book, .full-start__button.button--book').hide();
            }
        },
        
        _showCategoryMenu(movie) {
            const currentStatus = FavoritesManager.getStatus(Utils.getTmdbId(movie));
            
            const items = Categories.list.map(cat => ({
                title: `${cat.icon} ${cat.name}`,
                checked: currentStatus?.id === cat.id,
                category: cat.id
            }));
            
            items.push({ title: '──────────', separator: true });
            items.push({ title: '❌ Закрыть', action: 'close' });
            
            Lampa.Select.show({
                title: Utils.getTitle(movie),
                items: items,
                onSelect: (item) => {
                    if (item.category) {
                        if (currentStatus?.id === item.category) {
                            FavoritesManager.remove(Utils.getTmdbId(movie), item.category);
                        } else {
                            FavoritesManager.add(movie, item.category);
                        }
                        this._updateButton(movie);
                    }
                }
            });
        },
        
        _updateButton(movie) {
            const status = FavoritesManager.getStatus(Utils.getTmdbId(movie));
            const $btn = $('.favplus-card-btn');
            $btn.find('div:first-child').text(status?.icon || '⭐');
            $btn.find('span').text(status?.name || 'Избранное+');
        },
        
        addPosterStatus() {
            if (!Settings.get().poster_status) return;
            
            const originalRender = Lampa.Card?.render;
            if (originalRender) {
                Lampa.Card.render = function(item, category, params) {
                    const $card = originalRender.call(this, item, category, params);
                    
                    const status = FavoritesManager.getStatus(Utils.getTmdbId(item));
                    if (status) {
                        const position = Settings.get().poster_position;
                        $card.find('.card__view').append(`
                            <div class="favplus-poster-status" style="position:absolute;${position === 'top' ? 'top:8px' : position === 'center' ? 'top:50%;transform:translateY(-50%)' : 'bottom:8px'};left:8px;background:rgba(0,0,0,0.7);border-radius:20px;padding:4px 8px;font-size:11px;display:flex;align-items:center;gap:4px;z-index:2;">
                                <span>${status.icon}</span>
                                <span>${status.name}</span>
                            </div>
                        `);
                    }
                    
                    return $card;
                };
            }
        }
    };

    // ==================== ПЛЕЕР ====================
    const PlayerHandler = {
        interval: null,
        lastTime: 0,
        
        init() {
            this.interval = setInterval(() => this.check(), 2000);
        },
        
        check() {
            if (!Lampa.Player.opened()) return;
            
            const playerData = Lampa.Player.playdata();
            if (!playerData?.card) return;
            
            const currentTime = playerData.timeline?.time || 0;
            const duration = playerData.timeline?.duration || 0;
            
            if (currentTime > 0 && Math.abs(currentTime - this.lastTime) >= 5) {
                this.lastTime = currentTime;
                
                TimecodeManager.save(playerData.card, currentTime, duration, playerData.season, playerData.episode);
                
                const percent = duration > 0 ? (currentTime / duration * 100) : 0;
                AutoStatus.check(playerData.card, percent, playerData.season, playerData.episode);
            }
        }
    };

    // ==================== ЗАПУСК ====================
    function init() {
        console.log('[FavPlus] Starting v2.0...');
        
        // Добавляем стили
        $('<style>.favplus-poster-status { backdrop-filter: blur(4px); }</style>').appendTo('head');
        
        // Запуск модулей
        UI.addMenuButton();
        CardButtons.init();
        PlayerHandler.init();
        EpisodeTracker.start();
        
        // Периодические задачи
        setInterval(() => AutoStatus.checkAbandoned(), 24 * 60 * 60 * 1000);
        setInterval(() => AutoStatus.cleanCompleted(), 24 * 60 * 60 * 1000);
        
        // Обработчики событий
        Lampa.Listener.follow('full', (e) => {
            if (e.type === 'complite' && e.data?.movie) {
                HistoryManager.add(e.data.movie);
            }
        });
        
        console.log('[FavPlus] Ready!');
    }
    
    if (window.appready) init();
    else Lampa.Listener.follow('app', (e) => { if (e.type === 'ready') init(); });
})();
